/**
 * In-app help guides (prd-help-centre HC-1, D-#968–#972): the caller's own guides, the
 * নতুন seen-list and the হ্যাঁ / না answer. SELF for staff and guardians alike; which
 * guides come back is decided in HelpGuideService from the caller's own permissions.
 */
import { builder } from "../../../schema";
import {
  markHelpGuideRead,
  markHelpOpened,
  myHelpGuides,
  recordHelpFeedback,
  type HelpGuideView,
  type HelpRowView,
  type HelpStepView,
  type MyHelpView,
} from "../services/HelpGuideService";

const HelpStepRef = builder.objectRef<HelpStepView>("HelpStep").implement({
  fields: (t) => ({
    text: t.exposeString("text", { description: "Bangla; markup <b>…</b> only." }),
    box: t.exposeFloatList("box", { description: "[x, y, w, h] as fractions of the screenshot (0–1)." }),
  }),
});

const HelpRowRef = builder.objectRef<HelpRowView>("HelpRow").implement({
  fields: (t) => ({
    heading: t.exposeString("heading"),
    shotUrl: t.exposeString("shotUrl", { description: "Path under the API base; needs the login header." }),
    width: t.exposeInt("width"),
    height: t.exposeInt("height"),
    steps: t.field({ type: [HelpStepRef], resolve: (r) => r.steps }),
  }),
});

const HelpGuideRef = builder.objectRef<HelpGuideView>("HelpGuide").implement({
  description: "One small task's step-by-step guide (D-#968).",
  fields: (t) => ({
    id: t.exposeString("id"),
    category: t.exposeString("category"),
    title: t.exposeString("title"),
    intro: t.exposeString("intro"),
    keywords: t.exposeStringList("keywords"),
    screens: t.exposeStringList("screens", { description: "Route/Screen addresses whose header ? opens this guide." }),
    goToRoute: t.exposeString("goToRoute", { nullable: true }),
    goToScreen: t.exposeString("goToScreen", { nullable: true }),
    unlockedBy: t.exposeString("unlockedBy", {
      nullable: true,
      description: "Bangla name of the permission that unlocks it; null for an everyone/guardian guide.",
    }),
    isNew: t.exposeBoolean("isNew", { description: "Not yet opened and not seen at the first Help open (D-#972)." }),
    rows: t.field({ type: [HelpRowRef], resolve: (g) => g.rows }),
  }),
});

const HelpCategoryRef = builder.objectRef<{ id: string; title: string }>("HelpCategory").implement({
  fields: (t) => ({ id: t.exposeString("id"), title: t.exposeString("title") }),
});

const MyHelpRef = builder.objectRef<MyHelpView>("MyHelp").implement({
  fields: (t) => ({
    categories: t.field({ type: [HelpCategoryRef], resolve: (h) => h.categories }),
    guides: t.field({ type: [HelpGuideRef], resolve: (h) => h.guides }),
    firstOpen: t.exposeBoolean("firstOpen"),
  }),
});

builder.queryField("myHelpGuides", (t) =>
  t.field({
    type: MyHelpRef,
    description: "The help guides the caller may see, filtered by their own permissions (D-#969).",
    authScopes: { authenticated: true },
    resolve: (_root, _args, ctx) => myHelpGuides(ctx),
  }),
);

builder.mutationField("markHelpOpened", (t) =>
  t.boolean({
    description: "The help home was opened; sets the নতুন baseline on the first open (D-#972).",
    authScopes: { authenticated: true },
    resolve: (_root, _args, ctx) => markHelpOpened(ctx),
  }),
);

builder.mutationField("markHelpGuideRead", (t) =>
  t.boolean({
    description: "One guide was opened; its নতুন badge clears (D-#972).",
    authScopes: { authenticated: true },
    args: { guideId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) => markHelpGuideRead(ctx, args.guideId),
  }),
);

builder.mutationField("helpGuideFeedback", (t) =>
  t.boolean({
    description: "কাজে লেগেছে? হ্যাঁ / না on one guide; pressing again changes the answer.",
    authScopes: { authenticated: true },
    args: { guideId: t.arg.string({ required: true }), helpful: t.arg.boolean({ required: true }) },
    resolve: (_root, args, ctx) => recordHelpFeedback(ctx, args.guideId, args.helpful),
  }),
);
