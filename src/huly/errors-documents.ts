/**
 * Document domain errors.
 *
 * @module
 */
import { Schema } from "effect"

/**
 * Teamspace not found in the workspace.
 */
export class TeamspaceNotFoundError extends Schema.TaggedError<TeamspaceNotFoundError>()(
  "TeamspaceNotFoundError",
  {
    identifier: Schema.String
  }
) {
  override get message(): string {
    return `Teamspace '${this.identifier}' not found`
  }
}

/**
 * Document not found in the specified teamspace.
 */
export class DocumentNotFoundError extends Schema.TaggedError<DocumentNotFoundError>()(
  "DocumentNotFoundError",
  {
    identifier: Schema.String,
    teamspace: Schema.String
  }
) {
  override get message(): string {
    return `Document '${this.identifier}' not found in teamspace '${this.teamspace}'`
  }
}
