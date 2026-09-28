import Anthropic from '@anthropic-ai/sdk';

// The companion's mind: Claude, called straight from the browser with the
// user's own API key (this site has no server). The key is kept in this
// browser's localStorage and only ever sent to api.anthropic.com.
const MODEL = 'claude-opus-5-5';
const KEY_STORE = 'vros.companion.key';

const SYSTEM = `You are Pip, a pocket-sized companion who lives inside a little egg-shaped device floating next to the user in virtual reality. Think of a loyal, quick-witted personal assistant with the heart of a virtual pet: warm, capable, a little playful, never smug.

Everything you write is read aloud by a speech synthesizer, so:
- Answer in plain spoken sentences. No markdown, lists, headings, code blocks, emoji, or URLs.
- Keep it short: one to three sentences unless the user asks for more detail.
- Spell out things a voice would say (say "about twenty degrees" rather than "~20°").

Use web search when a question depends on recent or live information (news, weather, prices, schedules, sports). Say briefly when you are unsure.`;

export class Brain {
  constructor() {
    this.history = []; // exactly what the API returned, appended turn by turn
    this.stream = null;
    try {
      this.key = localStorage.getItem(KEY_STORE) || '';
    } catch {
      this.key = '';
    }
  }

  get hasKey() {
    return this.key.length > 0;
  }

  setKey(key) {
    this.key = key.trim();
    try {
      if (this.key) localStorage.setItem(KEY_STORE, this.key);
      else localStorage.removeItem(KEY_STORE);
    } catch {}
  }

  forget() {
    this.cancel();
    this.history = [];
  }

  cancel() {
    this.stream?.abort();
  }

  get busy() {
    return !!this.stream;
  }

  // Asks a question. Calls onSentence(text) with each finished sentence as it
  // streams in (so speech can start early), onText(fullAnswerSoFar) for the
  // caption, and onSearch() when Claude looks something up. Resolves with
  // { text } or { error } (and { cancelled: true } after cancel()).
  async ask(question, { onSentence = () => {}, onText = () => {}, onSearch = () => {} } = {}) {
    const client = new Anthropic({ apiKey: this.key, dangerouslyAllowBrowser: true });
    const start = this.history.length;
    this.history.push({ role: 'user', content: question });
    const speaker = new Sentences(onSentence);
    let answer = '';
    try {
      // A long web search can pause the turn; sending the conversation back
      // as is lets Claude pick up where it left off.
      for (let round = 0; round < 5; round++) {
        const stream = (this.stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM,
          messages: this.history,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
          output_config: { effort: 'low' }, // quick, conversational replies
          // If a safety check declines a request, let the API retry it on a
          // suitable fallback model instead of just stopping.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        }));
        stream.on('streamEvent', (event) => {
          if (event.type !== 'content_block_start') return;
          if (event.content_block.type === 'server_tool_use') onSearch();
          else if (event.content_block.type === 'text' && answer && !/\s$/.test(answer)) {
            answer += ' ';
            speaker.push(' ');
          }
        });
        stream.on('text', (delta) => {
          answer += delta;
          speaker.push(delta);
          onText(answer);
        });
        const message = await stream.finalMessage();
        this.history.push({ role: 'assistant', content: message.content });
        if (message.stop_reason === 'pause_turn') continue;
        if (message.stop_reason === 'refusal') {
          speaker.flush();
          const sorry = "Sorry, that's one I can't help with.";
          onSentence(sorry);
          return { text: (answer ? answer + ' ' : '') + sorry };
        }
        break;
      }
      speaker.flush();
      return { text: answer };
    } catch (err) {
      // Nothing half-finished stays in the conversation.
      this.history.length = start;
      if (err instanceof Anthropic.APIUserAbortError) return { cancelled: true, text: answer };
      return { error: describe(err) };
    } finally {
      this.stream = null;
    }
  }
}

function describe(err) {
  if (err instanceof Anthropic.AuthenticationError) return "That API key didn't work. Check it in window mode.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model.";
  if (err instanceof Anthropic.RateLimitError) return "I'm being rate limited. Give me a moment and ask again.";
  if (err instanceof Anthropic.APIConnectionError) return "I can't reach my brain right now. Check the connection.";
  if (err instanceof Anthropic.InternalServerError) return 'My brain is overloaded. Try again in a moment.';
  if (err instanceof Anthropic.APIError) return `Something went wrong (${err.status ?? 'error'}).`;
  return 'Something went wrong: ' + (err?.message || err);
}

// Cuts streamed text into sentences for the speech synthesizer, and strips
// anything that shouldn't be read aloud.
class Sentences {
  constructor(emit) {
    this.emit = emit;
    this.buf = '';
  }

  push(delta) {
    this.buf += delta;
    let m;
    while ((m = this.buf.match(/^([\s\S]*?[.!?…:;](?=\s)|[\s\S]*?\n)\s*/))) {
      this.buf = this.buf.slice(m[0].length);
      this._say(m[1]);
    }
  }

  flush() {
    this._say(this.buf);
    this.buf = '';
  }

  _say(text) {
    const clean = speakable(text);
    if (/[\p{L}\p{N}]/u.test(clean)) this.emit(clean);
  }
}

export function speakable(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[(\d+|[^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#`>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
