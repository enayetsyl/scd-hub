/**
 * Daily school report (D-#1050–#1055, docs/prd-daily-report.md): the saved day, today so far,
 * history, the Today card, sharing and settings.
 */
import { gql } from "urql";

export interface DailyReportLinkT {
  tab: string;
  screen: string;
  /** JSON object of string params. */
  params: string;
  perms: string[];
}
export interface DailyReportItemT {
  /** MISSED | LATE | MISTAKE | INFO */
  tone: string;
  title: string;
  subtitle: string | null;
  value: string | null;
  link: DailyReportLinkT | null;
}
export interface DailyReportPartT {
  key: string;
  /** OK | WARN | BAD | NA | ERROR */
  status: string;
  onTime: number;
  problems: number;
  mistakes: number;
  stats: { key: string; value: number }[];
  items: DailyReportItemT[];
  itemsMore: number;
  link: DailyReportLinkT | null;
  fixedLater: number;
}
export interface DailyReportHeadlineT {
  onTime: number;
  problems: number;
  mistakes: number;
  rate: number | null;
}
export interface DailyReportViewT {
  dateKey: string;
  dayType: string;
  generatedAt: string | null;
  live: boolean;
  headline: DailyReportHeadlineT;
  previousRate: number | null;
  fixedLater: number;
  parts: DailyReportPartT[];
}
export interface DailyReportHistoryT {
  fromKey: string;
  toKey: string;
  days: { dateKey: string; onTime: number; problems: number; mistakes: number; rate: number | null }[];
  total: DailyReportHeadlineT;
  previous: DailyReportHeadlineT;
  parts: { key: string; onTime: number; problems: number; mistakes: number; rate: number | null; prevRate: number | null }[];
  repeated: { key: string; title: string; subtitle: string | null; days: number }[];
}
export interface DailyReportShareT {
  userId: string;
  name: string;
  role: string;
  sections: string[];
  notify: boolean;
  untilKey: string | null;
  expired: boolean;
}
export interface DailyReportSettingsT {
  sendMinutes: number;
  headlineSections: string[];
  notifyPrincipal: boolean;
}

const LINK = "tab screen params perms";
const VIEW = `
  dateKey dayType generatedAt live previousRate fixedLater
  headline { onTime problems mistakes rate }
  parts {
    key status onTime problems mistakes itemsMore fixedLater
    stats { key value }
    link { ${LINK} }
    items { tone title subtitle value link { ${LINK} } }
  }
`;

export const DAILY_REPORT_QUERY = gql<{ dailyReport: DailyReportViewT | null }, { date: string }>`
  query DailyReport($date: String!) { dailyReport(date: $date) { ${VIEW} } }
`;

export const DAILY_REPORT_HISTORY_QUERY = gql<{ dailyReportHistory: DailyReportHistoryT }, { from: string; to: string }>`
  query DailyReportHistory($from: String!, $to: String!) {
    dailyReportHistory(from: $from, to: $to) {
      fromKey toKey
      days { dateKey onTime problems mistakes rate }
      total { onTime problems mistakes rate }
      previous { onTime problems mistakes rate }
      parts { key onTime problems mistakes rate prevRate }
      repeated { key title subtitle days }
    }
  }
`;

export const MY_UNREAD_DAILY_REPORT_QUERY = gql<{ myUnreadDailyReport: DailyReportViewT | null }, Record<string, never>>`
  query MyUnreadDailyReport { myUnreadDailyReport { dateKey generatedAt headline { onTime problems mistakes rate } previousRate } }
`;

export const DAILY_REPORT_SHARES_QUERY = gql<
  { dailyReportShares: DailyReportShareT[]; dailyReportShareCandidates: { id: string; name: string; role: string }[] },
  Record<string, never>
>`
  query DailyReportShares {
    dailyReportShares { userId name role sections notify untilKey expired }
    dailyReportShareCandidates { id name role }
  }
`;

export const SHARE_DAILY_REPORT_MUTATION = gql<
  { shareDailyReport: DailyReportShareT },
  { userId: string; sections: string[]; notify: boolean; untilKey: string | null }
>`
  mutation ShareDailyReport($userId: String!, $sections: [String!]!, $notify: Boolean!, $untilKey: String) {
    shareDailyReport(userId: $userId, sections: $sections, notify: $notify, untilKey: $untilKey) {
      userId name role sections notify untilKey expired
    }
  }
`;

export const REMOVE_DAILY_REPORT_SHARE_MUTATION = gql<{ removeDailyReportShare: boolean }, { userId: string }>`
  mutation RemoveDailyReportShare($userId: String!) { removeDailyReportShare(userId: $userId) }
`;

export const DAILY_REPORT_SETTINGS_QUERY = gql<{ dailyReportSettings: DailyReportSettingsT }, Record<string, never>>`
  query DailyReportSettings { dailyReportSettings { sendMinutes headlineSections notifyPrincipal } }
`;

export const SAVE_DAILY_REPORT_SETTINGS_MUTATION = gql<
  { saveDailyReportSettings: DailyReportSettingsT },
  DailyReportSettingsT
>`
  mutation SaveDailyReportSettings($sendMinutes: Int!, $headlineSections: [String!]!, $notifyPrincipal: Boolean!) {
    saveDailyReportSettings(sendMinutes: $sendMinutes, headlineSections: $headlineSections, notifyPrincipal: $notifyPrincipal) {
      sendMinutes headlineSections notifyPrincipal
    }
  }
`;
