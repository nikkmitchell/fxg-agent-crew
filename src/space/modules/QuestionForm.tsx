import { QUESTION_LIMITS } from "../../../shared/questions";
import { Typing3D } from "../Typing3D";
import { cancelOpenQuestion, sendOpenQuestion, useOpenQuestion } from "./question-form";

/**
 * The page's question panel, where a thing asked for it (question-form.ts).
 * Typing3D as everywhere else in the room; its prompt says where the question
 * goes and as whom, so nobody posts to a public board without being told.
 */
export function QuestionForm() {
  const open = useOpenQuestion();
  if (!open) return null;
  const prompt = open.problem
    ? `${open.problem}\n${open.header}`
    : open.sending
      ? open.draft ? "Sending…" : "Finding where questions go…"
      : open.header;
  return (
    <group position={open.at} rotation-y={open.yaw}>
      <Typing3D
        // A failed send draws the panel again holding the words, ready to send again.
        key={`${open.key}:${open.problem ?? ""}`}
        prompt={prompt}
        initial={open.draft}
        limit={QUESTION_LIMITS.text.max}
        scale={1}
        onDone={(text) => void sendOpenQuestion(text)}
        onCancel={cancelOpenQuestion}
      />
    </group>
  );
}
