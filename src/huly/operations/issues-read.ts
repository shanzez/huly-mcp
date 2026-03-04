/**
 * Issue read operations: list and get.
 *
 * @module
 */
import type { Person } from "@hcengineering/contact"
import { type DocumentQuery, type Ref, SortingOrder, type Status, type WithLookup } from "@hcengineering/core"
import { type Issue as HulyIssue } from "@hcengineering/tracker"
import { Effect } from "effect"

import type { GetIssueParams, Issue, IssueSummary, ListIssuesParams } from "../../domain/schemas.js"
import { IssueIdentifier, NonNegativeNumber, PersonId, PersonName, StatusName } from "../../domain/schemas/shared.js"
import { normalizeForComparison } from "../../utils/normalize.js"
import type { HulyClient, HulyClientError } from "../client.js"
import type { ComponentNotFoundError, InvalidStatusError, ProjectNotFoundError } from "../errors.js"
import { IssueNotFoundError } from "../errors.js"
import { contact, tracker } from "../huly-plugins.js"
import { findComponentByIdOrLabel } from "./components.js"
import { escapeLikeWildcards, withLookup } from "./query-helpers.js"
import {
  clampLimit,
  findIssueInProject,
  findPersonByEmailOrName,
  findProjectWithStatuses,
  parseIssueIdentifier,
  priorityToString,
  resolveStatusByName,
  type StatusInfo,
  zeroAsUnset
} from "./shared.js"

type ListIssuesError =
  | HulyClientError
  | ProjectNotFoundError
  | IssueNotFoundError
  | InvalidStatusError
  | ComponentNotFoundError

type GetIssueError =
  | HulyClientError
  | ProjectNotFoundError
  | IssueNotFoundError

const resolveStatusName = (
  statuses: Array<StatusInfo>,
  statusId: Ref<Status>
): string => {
  const statusDoc = statuses.find(s => s._id === statusId)
  return statusDoc?.name ?? "Unknown"
}

/**
 * List issues with filters.
 * Results sorted by modifiedOn descending.
 */
export const listIssues = (
  params: ListIssuesParams
): Effect.Effect<Array<IssueSummary>, ListIssuesError, HulyClient> =>
  Effect.gen(function*() {
    const { client, project, statuses } = yield* findProjectWithStatuses(params.project)

    const query: DocumentQuery<HulyIssue> = {
      space: project._id
    }

    if (params.status !== undefined) {
      const statusFilter = normalizeForComparison(params.status)

      if (statusFilter === "open") {
        const doneAndCanceledStatuses = statuses
          .filter(s => s.isDone || s.isCanceled)
          .map(s => s._id)

        if (doneAndCanceledStatuses.length > 0) {
          query.status = { $nin: doneAndCanceledStatuses }
        }
      } else if (statusFilter === "done") {
        const doneStatuses = statuses
          .filter(s => s.isDone)
          .map(s => s._id)

        if (doneStatuses.length > 0) {
          query.status = { $in: doneStatuses }
        } else {
          return []
        }
      } else if (statusFilter === "canceled") {
        const canceledStatuses = statuses
          .filter(s => s.isCanceled)
          .map(s => s._id)

        if (canceledStatuses.length > 0) {
          query.status = { $in: canceledStatuses }
        } else {
          return []
        }
      } else {
        query.status = yield* resolveStatusByName(statuses, params.status, params.project)
      }
    }

    if (params.assignee !== undefined) {
      const assigneePerson = yield* findPersonByEmailOrName(client, params.assignee)
      if (assigneePerson !== undefined) {
        query.assignee = assigneePerson._id
      } else {
        return []
      }
    }

    // Apply title search using $like operator
    if (params.titleSearch !== undefined && params.titleSearch.trim() !== "") {
      query.title = { $like: `%${escapeLikeWildcards(params.titleSearch)}%` }
    }

    if (params.descriptionSearch !== undefined && params.descriptionSearch.trim() !== "") {
      query.$search = params.descriptionSearch
    }

    if (params.parentIssue !== undefined) {
      const parentIssue = yield* findIssueInProject(client, project, params.parentIssue)
      query.attachedTo = parentIssue._id
    }

    if (params.component !== undefined) {
      const component = yield* findComponentByIdOrLabel(client, project._id, params.component)
      if (component !== undefined) {
        query.component = component._id
      } else {
        return []
      }
    }

    const limit = clampLimit(params.limit)

    type IssueWithLookup = WithLookup<HulyIssue> & {
      $lookup?: { assignee?: Person }
    }

    const issues = yield* client.findAll<IssueWithLookup>(
      tracker.class.Issue,
      query,
      withLookup<IssueWithLookup>(
        {
          limit,
          sort: {
            modifiedOn: SortingOrder.Descending
          }
        },
        { assignee: contact.class.Person }
      )
    )

    const summaries: Array<IssueSummary> = []
    for (const issue of issues) {
      const statusName = resolveStatusName(statuses, issue.status)
      const assigneeName = issue.$lookup?.assignee?.name
      const directParent = issue.parents.length > 0
        ? issue.parents[issue.parents.length - 1]
        : undefined

      summaries.push({
        identifier: IssueIdentifier.make(issue.identifier),
        title: issue.title,
        status: StatusName.make(statusName),
        priority: priorityToString(issue.priority),
        assignee: assigneeName !== undefined ? PersonName.make(assigneeName) : undefined,
        parentIssue: directParent !== undefined ? IssueIdentifier.make(directParent.identifier) : undefined,
        subIssues: issue.subIssues > 0 ? issue.subIssues : undefined,
        modifiedOn: issue.modifiedOn
      })
    }

    return summaries
  })

/**
 * Get a single issue with full details.
 *
 * Looks up issue by identifier (e.g., "HULY-123" or just 123).
 * Returns full issue including:
 * - Description rendered as markdown
 * - Assignee name (not just ID)
 * - Status name
 * - All metadata
 */
export const getIssue = (
  params: GetIssueParams
): Effect.Effect<Issue, GetIssueError, HulyClient> =>
  Effect.gen(function*() {
    const { client, project, statuses } = yield* findProjectWithStatuses(params.project)

    const { fullIdentifier, number } = parseIssueIdentifier(params.identifier, params.project)

    const issue = (yield* client.findOne<HulyIssue>(
      tracker.class.Issue,
      { space: project._id, identifier: fullIdentifier }
    )) ?? (number !== null
      ? yield* client.findOne<HulyIssue>(
        tracker.class.Issue,
        { space: project._id, number }
      )
      : undefined)
    if (issue === undefined) {
      return yield* new IssueNotFoundError({ identifier: params.identifier, project: params.project })
    }

    const statusName = resolveStatusName(statuses, issue.status)

    const person = issue.assignee !== null
      ? yield* client.findOne<Person>(contact.class.Person, { _id: issue.assignee })
      : undefined
    const assigneeName = person?.name
    const assigneeRef: Issue["assigneeRef"] = person
      ? { id: PersonId.make(person._id), name: PersonName.make(person.name) }
      : undefined

    const description = issue.description
      ? yield* client.fetchMarkup(
        issue._class,
        issue._id,
        "description",
        issue.description,
        "markdown"
      )
      : undefined

    const directParent = issue.parents.length > 0
      ? issue.parents[issue.parents.length - 1]
      : undefined

    const result: Issue = {
      identifier: IssueIdentifier.make(issue.identifier),
      title: issue.title,
      description,
      status: StatusName.make(statusName),
      priority: priorityToString(issue.priority),
      assignee: assigneeName !== undefined ? PersonName.make(assigneeName) : undefined,
      assigneeRef,
      project: params.project,
      parentIssue: directParent !== undefined ? IssueIdentifier.make(directParent.identifier) : undefined,
      subIssues: issue.subIssues > 0 ? issue.subIssues : undefined,
      modifiedOn: issue.modifiedOn,
      createdOn: issue.createdOn,
      dueDate: issue.dueDate ?? undefined,
      estimation: zeroAsUnset(NonNegativeNumber.make(issue.estimation))
    }

    return result
  })
