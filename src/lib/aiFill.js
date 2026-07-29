// Stub for "fill my knowledge". Swap this out for a real call to an LLM
// (e.g. the Claude API, ideally proxied through a backend route that holds
// the API key server-side rather than embedding it in the client) once
// you're ready to go live.
export async function fillKnowledge({ notes, childCount }) {
  await new Promise((resolve) => setTimeout(resolve, 900));

  const hasNotes = notes.trim().length > 0;

  return {
    filledNotes: hasNotes
      ? null
      : 'AI-generated summary would appear here once a model is connected.',
    correction: hasNotes
      ? 'AI fact-check would appear here once a model is connected.'
      : null,
    suggestedSubtopic:
      childCount < 2 ? 'Suggested subtopic (connect AI to generate)' : null,
  };
}
