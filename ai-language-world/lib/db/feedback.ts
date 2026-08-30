import { createClient } from "../supabase/server";
import type { FeedbackRow } from "./types";

export async function insertFeedback(params: {
  userId: string | null;
  pagePath: string;
  content: string;
}): Promise<FeedbackRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback")
    .insert({
      user_id: params.userId,
      page_path: params.pagePath,
      content: params.content,
    })
    .select()
    .single();

  if (error) throw error;
  return data as FeedbackRow;
}