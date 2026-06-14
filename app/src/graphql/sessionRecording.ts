/**
 * Typed GraphQL operations for CO-2 session recordings (footage). Mirrors the server
 * resolver (server/src/modules/classroom-observation/resolvers/sessionRecording.ts)
 * exactly — recordSessionRecording (observation:upload) + sessionRecording (P/O read).
 * Kept in its own module to avoid bloating operations.ts.
 */
import { gql } from "urql";

export interface SessionRecordingT {
  id: string;
  routineSlotId: string | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  subject: string;
  teacherId: string;
  classDate: string;
  periodNumber: number | null;
  youtubeVideoId: string;
  privacyStatus: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

const SESSION_RECORDING_FIELDS = `id routineSlotId sectionId subjectGroupId subject teacherId classDate periodNumber youtubeVideoId privacyStatus uploadedBy createdAt updatedAt`;

export const RECORD_SESSION_RECORDING = gql<
  { recordSessionRecording: SessionRecordingT },
  {
    subject: string;
    teacherId: string;
    classDate: string;
    youtubeVideoId: string;
    sectionId?: string | null;
    subjectGroupId?: string | null;
    routineSlotId?: string | null;
    periodNumber?: number | null;
  }
>`
  mutation RecordSessionRecording(
    $subject: String!, $teacherId: String!, $classDate: String!, $youtubeVideoId: String!,
    $sectionId: String, $subjectGroupId: String, $routineSlotId: String, $periodNumber: Int
  ) {
    recordSessionRecording(
      subject: $subject, teacherId: $teacherId, classDate: $classDate, youtubeVideoId: $youtubeVideoId,
      sectionId: $sectionId, subjectGroupId: $subjectGroupId, routineSlotId: $routineSlotId, periodNumber: $periodNumber
    ) { ${SESSION_RECORDING_FIELDS} }
  }
`;

export const SESSION_RECORDING_QUERY = gql<
  { sessionRecording: SessionRecordingT | null },
  { id: string }
>`
  query SessionRecording($id: String!) { sessionRecording(id: $id) { ${SESSION_RECORDING_FIELDS} } }
`;
