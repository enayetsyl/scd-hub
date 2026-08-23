/**
 * registerResolvers — the single side-effect import list that populates the Pothos
 * builder. Importing this module registers every query/mutation field; nothing else.
 *
 * Split out of index.ts (owner ask 2026-08-03) so the SCHEMA can be built without
 * booting the server: index.ts starts express, connects Mongo and listens, so a test
 * that wants the real schema could not import it. The GraphQL document-vs-schema gate
 * (graphqlDocuments.test.ts) imports this instead, then calls builder.toSchema().
 *
 * Keep this list complete: a resolver missing here is a field missing from the schema,
 * and the gate would then wrongly report an app query as invalid.
 */
import "./modules/foundation/resolvers/auth";
import "./modules/foundation/resolvers/users";
import "./modules/foundation/resolvers/classes";
import "./modules/foundation/resolvers/students";
import "./modules/foundation/resolvers/staff";
import "./modules/foundation/resolvers/guardians";
import "./modules/foundation/resolvers/provisioning";
import "./modules/foundation/resolvers/scopeGrants";
import "./modules/corpus/resolvers/analytics";
import "./modules/content/resolvers/content";
import "./modules/content/resolvers/review";
import "./modules/questions/resolvers/questions";
import "./modules/questions/resolvers/questionReview";
import "./modules/assessment/resolvers/assessment";
import "./modules/trackers/resolvers/trackers";
import "./modules/trackers/resolvers/homework";
import "./modules/trackers/resolvers/homeworkFiles";
import "./modules/trackers/resolvers/assignment";
import "./modules/trackers/resolvers/assignmentGift";
import "./modules/printing/resolvers/printRequest";
import "./modules/trackers/resolvers/wholePicture";
import "./modules/trackers/resolvers/studentProfile";
import "./modules/reports/resolvers/monthlyReport";
import "./modules/trackers/resolvers/reconReport";
import "./modules/trackers/resolvers/hwLifecycleReport";
import "./modules/trackers/resolvers/hwWeeklyDigest";
import "./modules/dashboard/resolvers/adminToday";
import "./modules/trackers/resolvers/classTest";
import "./modules/trackers/resolvers/classTestResult";
import "./modules/trackers/resolvers/classTestGuardian";
import "./modules/trackers/resolvers/classTestSummary";
import "./modules/routine/resolvers/routine";
import "./modules/routine/resolvers/routineSlots";
import "./modules/routine/resolvers/routineTriggers";
import "./modules/routine/resolvers/myDay";
import "./modules/routine/resolvers/teacherClassLoad";
import "./modules/attendance/resolvers/teacherAttendance";
import "./modules/attendance/resolvers/studentAttendance";
import "./modules/attendance/resolvers/push";
import "./modules/attendance/resolvers/attendanceRanking";
import "./modules/hr/resolvers/staffLeave";
import "./modules/hr/resolvers/payroll";
import "./modules/hr/resolvers/performance";
import "./modules/hr/resolvers/offboarding";
import "./modules/hr/resolvers/staffDirectory";
import "./modules/guardian/resolvers/guardianPortal";
import "./modules/notifications/resolvers/notifications";
import "./modules/notifications/resolvers/webPush";
import "./modules/library/resolvers/library";
import "./modules/library/resolvers/circulation";
import "./modules/library/resolvers/chase";
import "./modules/library/resolvers/libraryGuardian";
import "./modules/chat/resolvers/chat";
import "./modules/vocab/resolvers/vocabWord";
import "./modules/vocab/resolvers/vocabTest";
import "./modules/vocab/resolvers/vocabResult";
import "./modules/vocab/resolvers/vocabSummary";
import "./modules/vocab/resolvers/vocabGuardian";
import "./modules/templates/resolvers/messageTemplates";
import "./modules/comments/resolvers/studentComment";
import "./modules/comments/resolvers/commentDelivery";
import "./modules/classroom-observation/resolvers/classroomObservation";
import "./modules/classroom-observation/resolvers/sessionRecording";
import "./modules/classroom-observation/resolvers/observationTrend";
import "./modules/classroom-observation/resolvers/observationEffectiveness";
import "./modules/classroom-observation/resolvers/observationSchedule";
import "./modules/classroom-observation/resolvers/observationRota";
import "./modules/classroom-observation/resolvers/videoReview";
import "./modules/platform/resolvers/audit";
import "./modules/platform/resolvers/systemHealth";
import "./modules/engagement/resolvers/guardianView";
import "./modules/engagement/resolvers/guardianEngagement";
import "./modules/trackers/resolvers/classTestQuestion";
import "./modules/comments/resolvers/parentMeeting";
import "./modules/comments/resolvers/meetingDispatch";
import "./modules/comments/resolvers/meetingComment";
import "./modules/access-control/resolvers/accessControl";
import "./modules/support-book/resolvers/supportBook";
import "./modules/support-book/resolvers/supportBookSlots";
import "./modules/support-book/resolvers/supportBookReview";
import "./modules/support-book/resolvers/supportBookBuild";
import "./modules/support-book/resolvers/supportBookRationale";
import "./modules/support-book/resolvers/supportBookContent";
import "./modules/finance/resolvers/financeLedger";
import "./modules/finance/resolvers/financePosting";
import "./modules/finance/resolvers/feeSupport";
import "./modules/finance/resolvers/qardIou";
import "./modules/finance/resolvers/reconciliation";
import "./modules/finance/resolvers/budget";
import "./modules/finance/resolvers/financeDashboard";
import "./modules/saturday-revision/resolvers/revision";
import "./modules/saturday-revision/resolvers/revisionDelivery";
import "./modules/saturday-revision/resolvers/revisionSummary";
import "./modules/saturday-revision/resolvers/revisionGuardian";
import "./modules/english-drive/resolvers/englishDrive";
import "./modules/teaching-notes/resolvers/teachingNotes";
import "./modules/teaching-notes/resolvers/teachingNoteComments";
import "./modules/archive/resolvers/archive";
import "./modules/exams/resolvers/examSyllabus";
