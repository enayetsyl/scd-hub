/**
 * FreeMixingHomeScreen — the Free Mixing Observation tab's single entry
 * (owner ruling 2026-07-20: its own drawer item, NOT part of the Classroom
 * Observation hub). Role-routes: Principal/Office (observation:upload) get the
 * assign-and-status board; teachers (observation:review) get their own review
 * list. The server re-gates every action either way.
 */
import React from "react";
import { useAuth } from "../../auth/AuthContext";
import VideoReviewAdminScreen from "./VideoReviewAdminScreen";
import MyVideoReviewsScreen from "./MyVideoReviewsScreen";

export default function FreeMixingHomeScreen(): React.ReactElement {
  const { role, can } = useAuth();
  const canUpload = can("observation:upload");
  return canUpload ? <VideoReviewAdminScreen /> : <MyVideoReviewsScreen />;
}
