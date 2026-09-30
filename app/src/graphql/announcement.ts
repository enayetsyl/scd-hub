/**
 * The guardian announcement read (D-#700) — one query, asked once per app open.
 *
 * `todayKey` is the server's Asia/Dhaka date. The popup compares its stored
 * last-shown key against it rather than computing a date locally, so a wrong
 * device clock cannot change which day the school thinks it is.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export interface AnnouncementT {
  id: string;
  titleBn: string;
  bodyBn: string;
  /** The primary button's words. Empty means "use the default". */
  ctaBn: string;
  /** A guardian tab name; empty means the popup is informational only. */
  deepLinkTab: string;
  todayKey: string;
}

export const MY_ANNOUNCEMENT = gql<{ myAnnouncement: AnnouncementT | null }, NoVars>`
  query MyAnnouncement {
    myAnnouncement {
      id
      titleBn
      bodyBn
      ctaBn
      deepLinkTab
      todayKey
    }
  }
`;
