/**
 * Parents'-meeting comment chain + brief (docs/prd-meeting-comments.md, D-#752..#756).
 * One operation per surface: a caller without a permission never fires that request.
 * The class-teacher summary is still written through CM-5's SAVE_MEETING_COMMENT.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

// ---------------------------------------------------------------------------
// The brief (and the numbers every screen shows)
// ---------------------------------------------------------------------------

export interface BriefTrackerT {
  received: number;
  submitted: number;
  notSubmitted: number;
  bySubject: Array<{ subject: string; received: number; submitted: number; notSubmitted: number }>;
  missed: Array<{ dateKey: string; subject: string; description: string | null }>;
}

export interface BriefNumbersT {
  fromKey: string;
  toKey: string;
  attendance: {
    markedDays: number;
    presentDays: number;
    leaveDays: number;
    absentDays: number;
    days: Array<{ dateKey: string; kind: "LEAVE" | "ABSENT"; reason: string | null }>;
  };
  classTests: {
    held: number;
    sat: number;
    missed: number;
    avgPercent: number | null;
    bySubject: Array<{ subject: string; held: number; sat: number; missed: number; avgPercent: number | null }>;
    tests: Array<{ dateKey: string; subject: string; testNumber: number; present: boolean; percent: number | null }>;
  };
  homework: BriefTrackerT;
  assignment: BriefTrackerT;
  notes: {
    concern: number;
    positive: number;
    items: Array<{ dateKey: string; authorName: string | null; type: string; sentiment: string; text: string }>;
  };
}

export interface BriefSubjectNoteT {
  subject: string;
  teacherName: string | null;
  strengths: string;
  concerns: string;
  written: boolean;
  skipped: boolean;
  skipReason: string | null;
}

export interface MeetingBriefT {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  studentId: string;
  studentName: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  classTeacherName: string | null;
  slotTime: number | null;
  onCall: boolean;
  previousLabel: string | null;
  final: { source: "AS_IS" | "EDITED" | "OWN"; strengths: string; concerns: string; authorName: string | null; updatedAt: string } | null;
  summary: { strengths: string; concerns: string; authorName: string | null; updatedAt: string } | null;
  subjectNotes: BriefSubjectNoteT[];
  numbers: BriefNumbersT;
}

const TRACKER = `received submitted notSubmitted bySubject { subject received submitted notSubmitted } missed { dateKey subject description }`;
export const NUMBERS = `
  fromKey toKey
  attendance { markedDays presentDays leaveDays absentDays days { dateKey kind reason } }
  classTests { held sat missed avgPercent bySubject { subject held sat missed avgPercent } tests { dateKey subject testNumber present percent } }
  homework { ${TRACKER} }
  assignment { ${TRACKER} }
  notes { concern positive items { dateKey authorName type sentiment text } }
`;

export const MEETING_BRIEF = gql<{ meetingBrief: MeetingBriefT }, { meetingId: string; studentId: string }>`
  query MeetingBrief($meetingId: String!, $studentId: String!) {
    meetingBrief(meetingId: $meetingId, studentId: $studentId) {
      meetingId instanceLabel meetingDateKey studentId studentName classLevel classNameBn sectionNameBn
      classTeacherName slotTime onCall previousLabel
      final { source strengths concerns authorName updatedAt }
      summary { strengths concerns authorName updatedAt }
      subjectNotes { subject teacherName strengths concerns written skipped skipReason }
      numbers { ${NUMBERS} }
    }
  }
`;

// ---------------------------------------------------------------------------
// Subject teacher
// ---------------------------------------------------------------------------

export interface NoteWorkStudentT {
  studentId: string;
  name: string;
  written: boolean;
  skipped: boolean;
  locked: boolean;
}
export interface NoteWorkGroupT {
  sectionId: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  subject: string;
  total: number;
  written: number;
  due: number;
  students: NoteWorkStudentT[];
}
export interface NoteWorkMeetingT {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  subjectDueKey: string;
  total: number;
  due: number;
  groups: NoteWorkGroupT[];
}

export const MY_MEETING_NOTE_WORK = gql<{ myMeetingNoteWork: NoteWorkMeetingT[] }, NoVars>`
  query MyMeetingNoteWork {
    myMeetingNoteWork {
      meetingId instanceLabel meetingDateKey subjectDueKey total due
      groups { sectionId classLevel classNameBn sectionNameBn subject total written due students { studentId name written skipped locked } }
    }
  }
`;

export interface SubjectNoteContextT {
  meetingId: string;
  instanceLabel: string;
  studentId: string;
  studentName: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  subject: string;
  strengths: string;
  concerns: string;
  written: boolean;
  skipped: boolean;
  locked: boolean;
  mine: boolean;
  previousLabel: string | null;
  previousStrengths: string | null;
  previousConcerns: string | null;
  numbers: BriefNumbersT;
}

export const MEETING_SUBJECT_NOTE_CONTEXT = gql<
  { meetingSubjectNoteContext: SubjectNoteContextT },
  { meetingId: string; studentId: string; subject: string }
>`
  query MeetingSubjectNoteContext($meetingId: String!, $studentId: String!, $subject: String!) {
    meetingSubjectNoteContext(meetingId: $meetingId, studentId: $studentId, subject: $subject) {
      meetingId instanceLabel studentId studentName classLevel classNameBn sectionNameBn subject
      strengths concerns written skipped locked mine previousLabel previousStrengths previousConcerns
      numbers { ${NUMBERS} }
    }
  }
`;

export const SAVE_MEETING_SUBJECT_NOTE = gql<
  { saveMeetingSubjectNote: { studentId: string; subject: string; written: boolean } },
  { meetingId: string; studentId: string; subject: string; strengths?: string | null; concerns?: string | null }
>`
  mutation SaveMeetingSubjectNote($meetingId: String!, $studentId: String!, $subject: String!, $strengths: String, $concerns: String) {
    saveMeetingSubjectNote(meetingId: $meetingId, studentId: $studentId, subject: $subject, strengths: $strengths, concerns: $concerns) {
      studentId subject written
    }
  }
`;

// ---------------------------------------------------------------------------
// Class teacher
// ---------------------------------------------------------------------------

export type SummaryStateT = "WAITING" | "READY" | "DONE";

export interface SummaryWorkStudentT {
  studentId: string;
  name: string;
  state: SummaryStateT;
  total: number;
  written: number;
  skipped: number;
  missing: Array<{ subject: string; teacherName: string | null }>;
  finalDone: boolean;
}
export interface SummaryWorkSectionT {
  sectionId: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  ready: number;
  waiting: number;
  done: number;
  students: SummaryWorkStudentT[];
}
export interface SummaryWorkMeetingT {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  summaryDueKey: string;
  sections: SummaryWorkSectionT[];
}

export const MY_MEETING_SUMMARY_WORK = gql<{ myMeetingSummaryWork: SummaryWorkMeetingT[] }, NoVars>`
  query MyMeetingSummaryWork {
    myMeetingSummaryWork {
      meetingId instanceLabel meetingDateKey summaryDueKey
      sections {
        sectionId classLevel classNameBn sectionNameBn ready waiting done
        students { studentId name state total written skipped missing { subject teacherName } finalDone }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Office / Principal
// ---------------------------------------------------------------------------

export interface ProgressSubjectT {
  subject: string;
  teacherNames: string[];
  total: number;
  written: number;
  skipped: number;
  skipReason: string | null;
}
export interface ProgressSectionT {
  sectionId: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  classTeacherName: string | null;
  students: number;
  notesTotal: number;
  notesWritten: number;
  notesSkipped: number;
  summaryDone: number;
  summaryReady: number;
  finalDone: number;
  subjects: ProgressSubjectT[];
}
export interface CommentProgressT {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  open: boolean;
  subjectDueKey: string | null;
  summaryDueKey: string | null;
  openedAt: string | null;
  rosterBuiltAt: string | null;
  fromKey: string;
  toKey: string;
  students: number;
  notesTotal: number;
  notesWritten: number;
  notesSkipped: number;
  summaryDone: number;
  summaryReady: number;
  summaryWaiting: number;
  finalDone: number;
  finalReady: number;
  sections: ProgressSectionT[];
  teachers: Array<{ teacherId: string; name: string; left: number; places: string[] }>;
}

export const MEETING_COMMENT_PROGRESS = gql<{ meetingCommentProgress: CommentProgressT }, { meetingId: string }>`
  query MeetingCommentProgress($meetingId: String!) {
    meetingCommentProgress(meetingId: $meetingId) {
      meetingId instanceLabel meetingDateKey open subjectDueKey summaryDueKey openedAt rosterBuiltAt fromKey toKey
      students notesTotal notesWritten notesSkipped summaryDone summaryReady summaryWaiting finalDone finalReady
      sections {
        sectionId classLevel classNameBn sectionNameBn classTeacherName students
        notesTotal notesWritten notesSkipped summaryDone summaryReady finalDone
        subjects { subject teacherNames total written skipped skipReason }
      }
      teachers { teacherId name left places }
    }
  }
`;

const ROSTER = `inserted retargeted removed`;

export const OPEN_MEETING_COMMENTS = gql<
  { openMeetingComments: { inserted: number; retargeted: number; removed: number } },
  { meetingId: string; subjectDueKey: string; summaryDueKey: string }
>`
  mutation OpenMeetingComments($meetingId: String!, $subjectDueKey: String!, $summaryDueKey: String!) {
    openMeetingComments(meetingId: $meetingId, subjectDueKey: $subjectDueKey, summaryDueKey: $summaryDueKey) { ${ROSTER} }
  }
`;

export const REFRESH_MEETING_COMMENT_ROSTER = gql<
  { refreshMeetingCommentRoster: { inserted: number; retargeted: number; removed: number } },
  { meetingId: string }
>`
  mutation RefreshMeetingCommentRoster($meetingId: String!) {
    refreshMeetingCommentRoster(meetingId: $meetingId) { ${ROSTER} }
  }
`;

export const SET_MEETING_SUBJECT_SKIPPED = gql<
  { setMeetingSubjectSkipped: number },
  { meetingId: string; sectionId: string; subject: string; reason?: string | null }
>`
  mutation SetMeetingSubjectSkipped($meetingId: String!, $sectionId: String!, $subject: String!, $reason: String) {
    setMeetingSubjectSkipped(meetingId: $meetingId, sectionId: $sectionId, subject: $subject, reason: $reason)
  }
`;

export const REMIND_MEETING_TEACHER = gql<{ remindMeetingTeacher: boolean }, { meetingId: string; teacherId: string }>`
  mutation RemindMeetingTeacher($meetingId: String!, $teacherId: String!) {
    remindMeetingTeacher(meetingId: $meetingId, teacherId: $teacherId)
  }
`;

export interface FinalQueueRowT {
  studentId: string;
  name: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  state: SummaryStateT;
  finalSource: "AS_IS" | "EDITED" | "OWN" | null;
  slotTime: number | null;
  slotOrder: number | null;
}

export const MEETING_FINAL_QUEUE = gql<{ meetingFinalQueue: FinalQueueRowT[] }, { meetingId: string }>`
  query MeetingFinalQueue($meetingId: String!) {
    meetingFinalQueue(meetingId: $meetingId) {
      studentId name classLevel classNameBn sectionNameBn state finalSource slotTime slotOrder
    }
  }
`;

export const SAVE_MEETING_FINAL_COMMENT = gql<
  { saveMeetingFinalComment: { source: string; strengths: string; concerns: string } },
  { meetingId: string; studentId: string; source: "AS_IS" | "EDITED" | "OWN"; strengths?: string | null; concerns?: string | null }
>`
  mutation SaveMeetingFinalComment($meetingId: String!, $studentId: String!, $source: String!, $strengths: String, $concerns: String) {
    saveMeetingFinalComment(meetingId: $meetingId, studentId: $studentId, source: $source, strengths: $strengths, concerns: $concerns) {
      source strengths concerns
    }
  }
`;
