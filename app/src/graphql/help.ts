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
export interface HelpGuideT {
  id: string;
  category: string;
  title: string;
  intro: string;
  keywords: string[];
  screens: string[];
  goToRoute: string | null;
  goToScreen: string | null;
  unlockedBy: string | null;
  isNew: boolean;
  rows: HelpRowT[];
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
        id category title intro keywords screens goToRoute goToScreen unlockedBy isNew
        rows { heading shotUrl width height steps { text box } }
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
