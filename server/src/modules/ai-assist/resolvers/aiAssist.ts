/**
 * The AI teacher assistant (AI-6, D-#1096). `ai_assist:chat` for one's own conversations;
 * `ai_assist:read_all_chats` (LOCKED, Principal) to read every teacher's (D-#1104).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import {
  allAssistSessionsPage,
  askAssistant,
  assistantAvailable,
  assistantTopics,
  assistMessagesPage,
  myAssistSessionsPage,
  startAssistSession,
  type AssistMessageView,
  type AssistSessionView,
  type AssistTopic,
} from "../services/AiAssistService";

const SessionRef = builder.objectRef<AssistSessionView>("AiAssistSession").implement({
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.id }),
    teacherId: t.string({ resolve: (s) => s.teacherId }),
    teacherName: t.string({ nullable: true, resolve: (s) => s.teacherName }),
    classLevel: t.int({ resolve: (s) => s.classLevel }),
    subject: t.string({ resolve: (s) => s.subject }),
    chapter: t.string({ nullable: true, resolve: (s) => s.chapter }),
    sessionIndex: t.int({ nullable: true, resolve: (s) => s.sessionIndex }),
    title: t.string({ resolve: (s) => s.title }),
    turns: t.int({ resolve: (s) => s.turns }),
    lastAt: t.string({ resolve: (s) => new Date(s.lastAt).toISOString() }),
    createdAt: t.string({ resolve: (s) => new Date(s.createdAt).toISOString() }),
  }),
});

const MessageRef = builder.objectRef<AssistMessageView>("AiAssistMessage").implement({
  fields: (t) => ({
    id: t.string({ resolve: (m) => m.id }),
    role: t.string({ description: "user | assistant", resolve: (m) => m.role }),
    text: t.string({ resolve: (m) => m.text }),
    at: t.string({ resolve: (m) => new Date(m.at).toISOString() }),
  }),
});

const SessionPageRef = pageRef("AiAssistSessionPage", SessionRef);

type MessagePage = Awaited<ReturnType<typeof assistMessagesPage>>;
const MessagePageRef = builder.objectRef<MessagePage>("AiAssistMessagePage").implement({
  description: "One page of a conversation's turns, oldest first (D-#761), with the conversation.",
  fields: (t) => ({
    rows: t.field({ type: [MessageRef], resolve: (p) => p.rows }),
    total: t.int({ resolve: (p) => p.total }),
    page: t.int({ resolve: (p) => p.page }),
    pageSize: t.int({ resolve: (p) => p.pageSize }),
    session: t.field({ type: SessionRef, resolve: (p) => p.session }),
  }),
});

const SessionOptionRef = builder.objectRef<AssistTopic["chapters"][number]["sessions"][number]>("AiAssistSessionOption").implement({
  fields: (t) => ({
    sessionIndex: t.int({ resolve: (s) => s.sessionIndex }),
    titleBn: t.string({ resolve: (s) => s.titleBn }),
  }),
});
const ChapterRef = builder.objectRef<AssistTopic["chapters"][number]>("AiAssistChapter").implement({
  fields: (t) => ({
    chapter: t.string({ resolve: (c) => c.chapter }),
    title: t.string({ nullable: true, resolve: (c) => c.title }),
    sessions: t.field({ type: [SessionOptionRef], resolve: (c) => c.sessions }),
  }),
});
const TopicRef = builder.objectRef<AssistTopic>("AiAssistTopic").implement({
  fields: (t) => ({
    classLevel: t.int({ resolve: (x) => x.classLevel }),
    subject: t.string({ resolve: (x) => x.subject }),
    chapters: t.field({ type: [ChapterRef], resolve: (x) => x.chapters }),
  }),
});

builder.queryField("aiAssistantAvailable", (t) =>
  t.boolean({
    description: "The assistant feature is on and its rules are on. ai_assist:chat.",
    authScopes: { hasPermission: "ai_assist:chat" },
    resolve: (_r, _a, ctx) => assistantAvailable(ctx.auth),
  }),
);

builder.queryField("aiAssistTopics", (t) =>
  t.field({
    type: [TopicRef],
    description: "Class level × subject pairs with current session plans, and their chapters. ai_assist:chat.",
    authScopes: { hasPermission: "ai_assist:chat" },
    resolve: (_r, _a, ctx) => assistantTopics(ctx.auth),
  }),
);

builder.queryField("myAiAssistSessionsPage", (t) =>
  t.field({
    type: SessionPageRef,
    description: "My AI assistant conversations, newest first. ai_assist:chat.",
    authScopes: { hasPermission: "ai_assist:chat" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, args, ctx) => myAssistSessionsPage(ctx.auth, { page: args.page, pageSize: args.pageSize }),
  }),
);

builder.queryField("allAiAssistSessionsPage", (t) =>
  t.field({
    type: SessionPageRef,
    description: "Every teacher's AI assistant conversations (optionally one teacher). ai_assist:read_all_chats (LOCKED).",
    authScopes: { hasPermission: "ai_assist:read_all_chats" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }), teacherId: t.arg.string({ required: false }) },
    resolve: (_r, args, ctx) => allAssistSessionsPage(ctx.auth, { page: args.page, pageSize: args.pageSize, teacherId: args.teacherId }),
  }),
);

builder.queryField("aiAssistMessagesPage", (t) =>
  t.field({
    type: MessagePageRef,
    description: "One conversation's turns, oldest first. Own conversation (ai_assist:chat) or any (ai_assist:read_all_chats).",
    authScopes: { hasAnyPermission: ["ai_assist:chat", "ai_assist:read_all_chats"] },
    args: { sessionId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, args, ctx) => assistMessagesPage(ctx.auth, args.sessionId, { page: args.page, pageSize: args.pageSize }),
  }),
);

builder.mutationField("startAiAssistSession", (t) =>
  t.field({
    type: SessionRef,
    description: "Open a conversation about a class level × subject (× chapter × session). ai_assist:chat.",
    authScopes: { hasPermission: "ai_assist:chat" },
    args: {
      classLevel: t.arg.int({ required: true }),
      subject: t.arg.string({ required: true }),
      chapter: t.arg.string({ required: false }),
      sessionIndex: t.arg.int({ required: false }),
    },
    resolve: (_r, args, ctx) => startAssistSession(ctx.auth, { classLevel: args.classLevel, subject: args.subject, chapter: args.chapter, sessionIndex: args.sessionIndex }),
  }),
);

builder.mutationField("askAiAssistant", (t) =>
  t.field({
    type: [MessageRef],
    description: "Ask one question in my conversation; returns the question and the answer. De-identified, capped, metered. ai_assist:chat.",
    authScopes: { hasPermission: "ai_assist:chat" },
    args: { sessionId: t.arg.string({ required: true }), question: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => askAssistant(ctx.auth, args.sessionId, args.question),
  }),
);
