/**
 * Guardian release switch (D-#1011): which guardian-facing features (STORYBOOKS /
 * ACTIVITY_SHEETS) a family sees, and the switch screen for the Principal.
 */
import { gql } from "urql";

export interface GuardianFeaturePickT {
  guardianId: string;
  name: string;
  phone: string | null;
  childrenText: string;
}

export interface GuardianFeatureAccessT {
  feature: string;
  onForAll: boolean;
  guardians: GuardianFeaturePickT[];
}

export const MY_GUARDIAN_FEATURES = gql<{ myGuardianFeatures: string[] }>`
  query MyGuardianFeatures {
    myGuardianFeatures
  }
`;

const ACCESS_FIELDS = `
  feature
  onForAll
  guardians { guardianId name phone childrenText }
`;

export const GUARDIAN_FEATURE_ACCESS = gql<{ guardianFeatureAccess: GuardianFeatureAccessT }, { feature: string }>`
  query GuardianFeatureAccess($feature: String!) {
    guardianFeatureAccess(feature: $feature) { ${ACCESS_FIELDS} }
  }
`;

export const SEARCH_GUARDIANS_FOR_FEATURE = gql<{ searchGuardiansForFeature: GuardianFeaturePickT[] }, { feature: string; q: string }>`
  query SearchGuardiansForFeature($feature: String!, $q: String!) {
    searchGuardiansForFeature(feature: $feature, q: $q) { guardianId name phone childrenText }
  }
`;

export const SET_GUARDIAN_FEATURE_FOR_ALL = gql<{ setGuardianFeatureForAll: GuardianFeatureAccessT }, { feature: string; on: boolean }>`
  mutation SetGuardianFeatureForAll($feature: String!, $on: Boolean!) {
    setGuardianFeatureForAll(feature: $feature, on: $on) { ${ACCESS_FIELDS} }
  }
`;

export const SET_GUARDIAN_FEATURE_FOR_GUARDIAN = gql<
  { setGuardianFeatureForGuardian: GuardianFeatureAccessT },
  { feature: string; guardianId: string; on: boolean }
>`
  mutation SetGuardianFeatureForGuardian($feature: String!, $guardianId: String!, $on: Boolean!) {
    setGuardianFeatureForGuardian(feature: $feature, guardianId: $guardianId, on: $on) { ${ACCESS_FIELDS} }
  }
`;
