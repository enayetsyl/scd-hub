/**
 * AL-6b (AC-C12): the server refuses a second weekly assignment for one week × শাখা × subject with a Bangla
 * sentence (`SECOND_ASSIGNMENT_MESSAGE`). The screens show it as it is and add a button to the extra-homework
 * screen; this recognises the sentence by its stable opening.
 */
export const SECOND_ASSIGNMENT_PREFIX = "এই সপ্তাহে এই শাখা-বিষয়ের অ্যাসাইনমেন্ট আগেই দেওয়া হয়েছে";

export const isSecondAssignmentRefusal = (message: string | null | undefined): boolean =>
  typeof message === "string" && message.includes(SECOND_ASSIGNMENT_PREFIX);
