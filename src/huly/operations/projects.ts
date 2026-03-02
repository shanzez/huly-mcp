/**
 * Project domain operations for Huly MCP server.
 *
 * Provides typed operations for querying projects from Huly platform.
 * Operations use HulyClient service and return typed domain objects.
 *
 * @module
 */
import type { Data, DocumentQuery, DocumentUpdate, Ref, Space } from "@hcengineering/core"
import { generateId, SortingOrder } from "@hcengineering/core"
import type { IssueStatus, Project as HulyProject } from "@hcengineering/tracker"
import { TimeReportDayType } from "@hcengineering/tracker"
import { Effect } from "effect"

import type {
  CreateProjectParams,
  CreateProjectResult,
  DeleteProjectParams,
  DeleteProjectResult,
  GetProjectParams,
  ListProjectsParams,
  ListProjectsResult,
  Project,
  ProjectSummary,
  UpdateProjectParams,
  UpdateProjectResult
} from "../../domain/schemas.js"
import { ProjectIdentifier, StatusName } from "../../domain/schemas/shared.js"
import { HulyClient, type HulyClientError } from "../client.js"
import type { ProjectNotFoundError } from "../errors.js"
import { tracker } from "../huly-plugins.js"
import { clampLimit, findProject, findProjectWithStatuses, toRef } from "./shared.js"

type ListProjectsError = HulyClientError
type GetProjectError = ProjectNotFoundError | HulyClientError
type CreateProjectError = HulyClientError
type UpdateProjectError = ProjectNotFoundError | HulyClientError
type DeleteProjectError = ProjectNotFoundError | HulyClientError

export const listProjects = (
  params: ListProjectsParams
): Effect.Effect<ListProjectsResult, ListProjectsError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const query: DocumentQuery<HulyProject> = {}
    if (!params.includeArchived) {
      query.archived = false
    }

    const limit = clampLimit(params.limit)

    const projects = yield* client.findAll<HulyProject>(
      tracker.class.Project,
      query,
      {
        limit,
        sort: {
          name: SortingOrder.Ascending
        }
      }
    )

    const total = projects.total

    const summaries: Array<ProjectSummary> = projects.map((project) => ({
      identifier: ProjectIdentifier.make(project.identifier),
      name: project.name,
      description: project.description || undefined,
      archived: project.archived
    }))

    return {
      projects: summaries,
      total
    }
  })

export const getProject = (
  params: GetProjectParams
): Effect.Effect<Project, GetProjectError, HulyClient> =>
  Effect.gen(function*() {
    const { project, statuses } = yield* findProjectWithStatuses(params.project)

    const defaultStatus = statuses.find(s => s._id === project.defaultIssueStatus)

    const result: Project = {
      identifier: ProjectIdentifier.make(project.identifier),
      name: project.name,
      description: project.description || undefined,
      archived: project.archived,
      defaultStatus: defaultStatus ? StatusName.make(defaultStatus.name) : undefined,
      statuses: statuses.map(s => StatusName.make(s.name))
    }

    return result
  })

export const createProject = (
  params: CreateProjectParams
): Effect.Effect<CreateProjectResult, CreateProjectError, HulyClient> =>
  Effect.gen(function*() {
    const client = yield* HulyClient

    const existing = yield* client.findOne<HulyProject>(
      tracker.class.Project,
      { identifier: params.identifier }
    )

    if (existing !== undefined) {
      return {
        identifier: ProjectIdentifier.make(existing.identifier),
        name: existing.name,
        created: false
      }
    }

    const projectId: Ref<HulyProject> = generateId()

    // Data<HulyProject> requires all non-Doc fields from the type hierarchy:
    // Space: name, description, private, members, archived
    // TypedSpace: type (Ref<SpaceType>)
    // Project: identifier, sequence, defaultIssueStatus, defaultTimeReportDay
    // IconProps: icon, color (optional)
    // Huly's classic project type is the standard tracker ProjectType.
    // defaultIssueStatus uses a placeholder ref; Huly resolves it from ProjectType statuses.
    const projectData: Data<HulyProject> = {
      name: params.name,
      description: params.description ?? "",
      private: params.private ?? false,
      members: [],
      archived: false,
      identifier: params.identifier,
      sequence: 0,
      // Huly SDK: defaultIssueStatus expects Ref<IssueStatus> but is set by the platform
      // on first issue creation. Empty string sentinel is safe for initial project creation.
      defaultIssueStatus: "" as Ref<IssueStatus>,
      defaultTimeReportDay: TimeReportDayType.CurrentWorkDay,
      // tracker.ids.ClassingProjectType is the default classic tracker ProjectType.
      type: tracker.ids.ClassingProjectType
    }

    // Tracker projects are self-referential: the project _id is its own space.
    // toRef bridges the phantom-typed Ref boundary.
    const spaceRef = toRef<Space>(projectId)

    yield* client.createDoc(
      tracker.class.Project,
      spaceRef,
      projectData,
      projectId
    )

    return {
      identifier: ProjectIdentifier.make(params.identifier),
      name: params.name,
      created: true
    }
  })

export const updateProject = (
  params: UpdateProjectParams
): Effect.Effect<UpdateProjectResult, UpdateProjectError, HulyClient> =>
  Effect.gen(function*() {
    const { client, project } = yield* findProject(params.project)

    const updateOps: DocumentUpdate<HulyProject> = {}

    if (params.name !== undefined) {
      updateOps.name = params.name
    }

    if (params.description !== undefined) {
      updateOps.description = params.description === null ? "" : params.description
    }

    if (Object.keys(updateOps).length === 0) {
      return { identifier: ProjectIdentifier.make(project.identifier), updated: false }
    }

    yield* client.updateDoc(
      tracker.class.Project,
      toRef<Space>(project._id),
      project._id,
      updateOps
    )

    return { identifier: ProjectIdentifier.make(project.identifier), updated: true }
  })

export const deleteProject = (
  params: DeleteProjectParams
): Effect.Effect<DeleteProjectResult, DeleteProjectError, HulyClient> =>
  Effect.gen(function*() {
    const { client, project } = yield* findProject(params.project)

    yield* client.removeDoc(
      tracker.class.Project,
      toRef<Space>(project._id),
      project._id
    )

    return { identifier: ProjectIdentifier.make(project.identifier), deleted: true }
  })
