import { createClient } from "../supabase/server";
import type { FeedbackRow } from "./types";

export async function insertFeedback(params: {
  userId: string | null;
  pagePath: string;
  content: string;
}): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("feedback")
    .insert({
      user_id: params.userId,
      page_path: params.pagePath,
      content: params.content,
    });

  if (error) {
    throw error;
  }
}