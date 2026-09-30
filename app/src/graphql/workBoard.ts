/**
 * Work board operations (WB-1..WB-3, D-#701) — mirror server/src/modules/workboard/resolvers/workBoard.ts.
 */
import { gql } from "urql";
import type { DaySlot, TaskPriority, TaskRecurrence, TaskStatus, WorkCardKind } from "@scd/shared";

type NoVars = Record<string, never>;

export interface WorkCardLinkT {
  screen: string;
  paramsJson: string;
}

export interface WorkCardT {
  key: string;
  kind: WorkCardKind;
  userId: string;
  titleBn: string;
  detailBn: string | null;
  dateKey: string;
  slot: DaySlot;
  startMin: number | null;
  effortMin: number;
  status: TaskStatus;
  overdue: boolean;
  priority: TaskPriority | null;
  blockedReason: string | null;
  assignedById: string | null;
  assignedByName: string | null;
  forLabel: string | null;
  taskId: string | null;
  sourceId: string | null;
  link: WorkCardLinkT | null;
  /** WB-5 (D-#702): office-queue cover — the viewer may take it, or someone already has. */
  canPull: boolean;
  pulledById: string | null;
  pulledByName: string | null;
}

export interface TaskT {
  id: string;
  titleBn: string;
  notes: string | null;
  assigneeUserId: string;
  assigneeName: string | null;
  assignedBy: string;
  assignedByName: string | null;
  forLabel: string | null;
  priority: TaskPriority;
  dueKey: string;
  slot: DaySlot;
  effortMin: number;
  status: TaskStatus;
  blockedReason: string | null;
  blockedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  templateId: string | null;
  createdAt: string;
}

export interface TaskTemplateT {
  id: string;
  titleBn: string;
  notes: string | null;
  assigneeUserId: string;
  assigneeName: string | null;
  forLabel: string | null;
  priority: TaskPriority;
  slot: DaySlot;
  effortMin: number;
  recurrence: TaskRecurrence;
  weekdays: number[];
  monthDay: number | null;
  weekOfMonth: number | null;
  active: boolean;
}

export interface LoadCellT {
  dateKey: string;
  minutes: number;
  openCards: number;
  level: "ok" | "amber" | "red";
}

export interface LoadRowT {
  userId: string;
  name: string;
  category: string | null;
  cells: LoadCellT[];
  weekMinutes: number;
}

export interface AssignableStaffT {
  userId: string;
  name: string;
  role: string;
  category: string | null;
  todayMinutes: number;
  todayLevel: "ok" | "amber" | "red";
}

const CARD_FIELDS = `
  key kind userId titleBn detailBn dateKey slot startMin effortMin status overdue priority
  blockedReason assignedById assignedByName forLabel taskId sourceId
  canPull pulledById pulledByName
  link { screen paramsJson }
`;

export const PULL_WORK_CARD = gql<{ pullWorkCard: boolean }, { kind: string; sourceId: string }>`
  mutation PullWorkCard($kind: String!, $sourceId: String!) {
    pullWorkCard(kind: $kind, sourceId: $sourceId)
  }
`;

export const RELEASE_WORK_CARD = gql<{ releaseWorkCard: boolean }, { kind: string; sourceId: string }>`
  mutation ReleaseWorkCard($kind: String!, $sourceId: String!) {
    releaseWorkCard(kind: $kind, sourceId: $sourceId)
  }
`;

const TASK_FIELDS = `
  id titleBn notes assigneeUserId assigneeName assignedBy assignedByName forLabel priority dueKey slot
  effortMin status blockedReason blockedAt startedAt doneAt templateId createdAt
`;

const TEMPLATE_FIELDS = `
  id titleBn notes assigneeUserId assigneeName forLabel priority slot effortMin recurrence weekdays monthDay weekOfMonth active
`;

export const MY_WORK_BOARD_QUERY = gql<{ myWorkBoard: WorkCardT[] }, { fromKey: string; toKey: string }>`
  query MyWorkBoard($fromKey: String!, $toKey: String!) {
    myWorkBoard(fromKey: $fromKey, toKey: $toKey) { ${CARD_FIELDS} }
  }
`;

export const WORK_BOARD_FOR_QUERY = gql<{ workBoardFor: WorkCardT[] }, { userId: string; fromKey: string; toKey: string }>`
  query WorkBoardFor($userId: String!, $fromKey: String!, $toKey: String!) {
    workBoardFor(userId: $userId, fromKey: $fromKey, toKey: $toKey) { ${CARD_FIELDS} }
  }
`;

export const MY_WORK_BOARD_COUNTS = gql<{ myWorkBoardCounts: { openToday: number; overdue: number } }, NoVars>`
  query MyWorkBoardCounts {
    myWorkBoardCounts { openToday overdue }
  }
`;

export const TASK_QUERY = gql<{ task: TaskT }, { id: string }>`
  query Task($id: String!) {
    task(id: $id) { ${TASK_FIELDS} }
  }
`;

export const TASKS_ASSIGNED_BY_ME_QUERY = gql<{ tasksAssignedByMe: TaskT[] }, { open?: boolean | null }>`
  query TasksAssignedByMe($open: Boolean) {
    tasksAssignedByMe(open: $open) { ${TASK_FIELDS} }
  }
`;

export const WORK_LOAD_GRID_QUERY = gql<{ workLoadGrid: LoadRowT[] }, { fromKey: string; toKey: string }>`
  query WorkLoadGrid($fromKey: String!, $toKey: String!) {
    workLoadGrid(fromKey: $fromKey, toKey: $toKey) {
      userId name category weekMinutes
      cells { dateKey minutes openCards level }
    }
  }
`;

export const ASSIGNABLE_STAFF_QUERY = gql<{ assignableStaff: AssignableStaffT[] }, NoVars>`
  query AssignableStaff {
    assignableStaff { userId name role category todayMinutes todayLevel }
  }
`;

export const TASK_TEMPLATES_QUERY = gql<{ taskTemplates: TaskTemplateT[] }, NoVars>`
  query TaskTemplates {
    taskTemplates { ${TEMPLATE_FIELDS} }
  }
`;

export interface TaskInputT {
  titleBn: string;
  notes?: string | null;
  assigneeUserId: string;
  forLabel?: string | null;
  priority?: TaskPriority | null;
  dueKey: string;
  slot?: DaySlot | null;
  effortMin: number;
}

export interface TaskPatchT {
  titleBn?: string | null;
  notes?: string | null;
  forLabel?: string | null;
  priority?: TaskPriority | null;
  dueKey?: string | null;
  slot?: DaySlot | null;
  effortMin?: number | null;
}

export interface TaskTemplateInputT {
  titleBn: string;
  notes?: string | null;
  assigneeUserId: string;
  forLabel?: string | null;
  priority?: TaskPriority | null;
  slot?: DaySlot | null;
  effortMin: number;
  recurrence: TaskRecurrence;
  weekdays?: number[] | null;
  monthDay?: number | null;
  weekOfMonth?: number | null;
}

export const CREATE_TASK = gql<{ createTask: TaskT }, { input: TaskInputT }>`
  mutation CreateTask($input: TaskInput!) {
    createTask(input: $input) { ${TASK_FIELDS} }
  }
`;

export const UPDATE_TASK = gql<{ updateTask: TaskT }, { id: string; patch: TaskPatchT }>`
  mutation UpdateTask($id: String!, $patch: TaskPatch!) {
    updateTask(id: $id, patch: $patch) { ${TASK_FIELDS} }
  }
`;

export const SET_TASK_STATUS = gql<{ setTaskStatus: TaskT }, { id: string; status: TaskStatus }>`
  mutation SetTaskStatus($id: String!, $status: TaskStatus!) {
    setTaskStatus(id: $id, status: $status) { ${TASK_FIELDS} }
  }
`;

export const SET_TASK_BLOCKED = gql<{ setTaskBlocked: TaskT }, { id: string; reason?: string | null }>`
  mutation SetTaskBlocked($id: String!, $reason: String) {
    setTaskBlocked(id: $id, reason: $reason) { ${TASK_FIELDS} }
  }
`;

export const REASSIGN_TASK = gql<{ reassignTask: TaskT }, { id: string; assigneeUserId: string }>`
  mutation ReassignTask($id: String!, $assigneeUserId: String!) {
    reassignTask(id: $id, assigneeUserId: $assigneeUserId) { ${TASK_FIELDS} }
  }
`;

export const MOVE_TASK = gql<{ moveTask: TaskT }, { id: string; dueKey?: string | null; slot?: DaySlot | null }>`
  mutation MoveTask($id: String!, $dueKey: String, $slot: DaySlot) {
    moveTask(id: $id, dueKey: $dueKey, slot: $slot) { ${TASK_FIELDS} }
  }
`;

export const CANCEL_TASK = gql<{ cancelTask: TaskT }, { id: string }>`
  mutation CancelTask($id: String!) {
    cancelTask(id: $id) { ${TASK_FIELDS} }
  }
`;

export const CREATE_TASK_TEMPLATE = gql<{ createTaskTemplate: TaskTemplateT }, { input: TaskTemplateInputT }>`
  mutation CreateTaskTemplate($input: TaskTemplateInput!) {
    createTaskTemplate(input: $input) { ${TEMPLATE_FIELDS} }
  }
`;

export const SET_TASK_TEMPLATE_ACTIVE = gql<{ setTaskTemplateActive: TaskTemplateT }, { id: string; active: boolean }>`
  mutation SetTaskTemplateActive($id: String!, $active: Boolean!) {
    setTaskTemplateActive(id: $id, active: $active) { ${TEMPLATE_FIELDS} }
  }
`;
