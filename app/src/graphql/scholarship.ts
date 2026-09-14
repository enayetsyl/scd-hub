/**
 * Scholarship practice-paper operations (SC-0..SC-4, docs/prd-scholarship-practice.md).
 *
 * Every field a screen reads is SELECTED here. A field the server has and the document
 * does not is `undefined` at runtime while TypeScript still says it is there — the
 * QR-10 class of bug — so the selections deliberately mirror what each screen renders,
 * including the nullables (`percent`, `classPercent`) whose NULLNESS is the message.
 */
import { gql } from "urql";

export const SCHOLARSHIP_TOPICS_QUERY = gql`
  query ScholarshipTopics($classLevel: Int!, $subject: String) {
    scholarshipTopics(classLevel: $classLevel, subject: $subject) {
      code
      labelBn
      subject
      axis
      chapters
      order
      active
    }
  }
`;

export const SCHOLARSHIP_PAPERS_QUERY = gql`
  query ScholarshipPapers($sectionId: String!, $subject: String) {
    scholarshipPapers(sectionId: $sectionId, subject: $subject) {
      id
      paperId
      name
      subjects
      paperDate
      totalMarks
      itemCount
      status
      scoredCount
      presentCount
      classPercent
    }
  }
`;

export const SCHOLARSHIP_PAPER_QUERY = gql`
  query ScholarshipPaper($id: String!) {
    scholarshipPaper(id: $id) {
      id
      paperId
      name
      subjects
      sectionId
      classLevel
      paperDate
      totalMarks
      durationMinutes
      sourceNote
      status
      items {
        itemNo
        label
        subject
        topicCode
        topicLabel
        chapters
        itemType
        marks
      }
      roster {
        studentId
        nameBn
        status
        total
        itemMarks {
          itemNo
          marks
        }
      }
    }
  }
`;

export const SCHOLARSHIP_STUDENT_QUERY = gql`
  query ScholarshipStudent($sectionId: String!, $classLevel: Int!, $studentId: String!, $subject: String) {
    scholarshipStudent(
      sectionId: $sectionId
      classLevel: $classLevel
      studentId: $studentId
      subject: $subject
    ) {
      studentId
      papersSat
      totalEarned
      totalAvailable
      overallPercent
      topics {
        key
        label
        subject
        earned
        available
        percent
        band
        classPercent
        classGap
        behindClass
        paperCount
      }
      chapters {
        key
        label
        subject
        earned
        available
        percent
        band
        classPercent
        classGap
        behindClass
        paperCount
      }
    }
  }
`;

export const SCHOLARSHIP_CLASS_QUERY = gql`
  query ScholarshipClass($sectionId: String!, $classLevel: Int!, $subject: String, $axis: String) {
    scholarshipClass(sectionId: $sectionId, classLevel: $classLevel, subject: $subject, axis: $axis) {
      students {
        id
        nameBn
      }
      rows {
        key
        label
        subject
        classPercent
        band
        cells {
          studentId
          percent
          band
          available
        }
      }
    }
  }
`;

export const SCHOLARSHIP_ITEMS_CHECK_QUERY = gql`
  query ScholarshipItemsCheck(
    $classLevel: Int!
    $subjects: [String!]!
    $totalMarks: Float!
    $items: [ScholarshipItemInput!]!
  ) {
    scholarshipItemsCheck(
      classLevel: $classLevel
      subjects: $subjects
      totalMarks: $totalMarks
      items: $items
    )
  }
`;

export const SAVE_SCHOLARSHIP_TOPIC = gql`
  mutation SaveScholarshipTopic(
    $subject: String!
    $classLevel: Int!
    $labelBn: String!
    $axis: String!
    $chapters: [Int!]
    $order: Int
  ) {
    saveScholarshipTopic(
      subject: $subject
      classLevel: $classLevel
      labelBn: $labelBn
      axis: $axis
      chapters: $chapters
      order: $order
    )
  }
`;

export const RETIRE_SCHOLARSHIP_TOPIC = gql`
  mutation RetireScholarshipTopic($subject: String!, $classLevel: Int!, $code: String!) {
    retireScholarshipTopic(subject: $subject, classLevel: $classLevel, code: $code)
  }
`;

export const DECLARE_SCHOLARSHIP_PAPER = gql`
  mutation DeclareScholarshipPaper(
    $sectionId: String!
    $subjects: [String!]!
    $name: String!
    $paperDate: String
    $totalMarks: Float!
    $durationMinutes: Int
    $sourceNote: String
    $items: [ScholarshipItemInput!]!
  ) {
    declareScholarshipPaper(
      sectionId: $sectionId
      subjects: $subjects
      name: $name
      paperDate: $paperDate
      totalMarks: $totalMarks
      durationMinutes: $durationMinutes
      sourceNote: $sourceNote
      items: $items
    )
  }
`;

export const ENTER_SCHOLARSHIP_SCORES = gql`
  mutation EnterScholarshipScores($paperId: String!, $rows: [ScholarshipScoreRowInput!]!) {
    enterScholarshipScores(paperId: $paperId, rows: $rows)
  }
`;
