/**
 * In-app help guides (prd-help-centre, D-#968–#972) — server: modules/help/resolvers/help.ts.
 * The server already filtered the list to the caller's own permissions.
 */
import { gql } from "urql";

export interface HelpStepT {
  text: string;
  /** [x, y, w, h] as fractions of the screenshot. */
  box: number[];
}
export interface HelpRowT {
  heading: string;
  shotUrl: string;
  width: number;
  height: number;
  steps: HelpStepT[];
}
/** One block of a reading guide (D-#1280): exactly one of p / list / check / table is set. */
export interface HelpBlockT {
  p: string | null;
  list: string[] | null;
  check: string[] | null;
  tableHead: string[] | null;
  tableRows: Array<{ cells: string[] }> | null;
}
export interface HelpSectionT {
  heading: string;
  blocks: HelpBlockT[];
}
export interface HelpGuideT {
  id: string;
  /** "steps" (screenshot rows) or "read" (text sections, D-#1280). */
  kind: string;
  category: string;
  title: string;
  intro: string;
  keywords: string[];
  screens: string[];
  goToRoute: string | null;
  goToScreen: string | null;
  unlockedBy: string | null;
  isNew: boolean;
  /** Empty on a reading guide. */
  rows: HelpRowT[];
  /** Empty on a steps guide. */
  sections: HelpSectionT[];
}
export interface MyHelpT {
  categories: Array<{ id: string; title: string }>;
  guides: HelpGuideT[];
  firstOpen: boolean;
}

export const MY_HELP_GUIDES = gql<{ myHelpGuides: MyHelpT }, Record<string, never>>`
  query MyHelpGuides {
    myHelpGuides {
      categories { id title }
      firstOpen
      guides {
        id kind category title intro keywords screens goToRoute goToScreen unlockedBy isNew
        rows { heading shotUrl width height steps { text box } }
        sections { heading blocks { p list check tableHead tableRows { cells } } }
      }
    }
  }
`;

export const MARK_HELP_OPENED = gql<{ markHelpOpened: boolean }, Record<string, never>>`
  mutation MarkHelpOpened {
    markHelpOpened
  }
`;

export const MARK_HELP_GUIDE_READ = gql<{ markHelpGuideRead: boolean }, { guideId: string }>`
  mutation MarkHelpGuideRead($guideId: String!) {
    markHelpGuideRead(guideId: $guideId)
  }
`;

export const HELP_GUIDE_FEEDBACK = gql<{ helpGuideFeedback: boolean }, { guideId: string; helpful: boolean }>`
  mutation HelpGuideFeedback($guideId: String!, $helpful: Boolean!) {
    helpGuideFeedback(guideId: $guideId, helpful: $helpful)
  }
`;
