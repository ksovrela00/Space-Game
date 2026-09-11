// Состояния игры и лента сообщений.

export const ST = {
  FLIGHT: 'flight',
  DOCKED: 'docked',
  LANDED: 'landed',       // стоим на поверхности тела
  CRASHED: 'crashed',
  MAP: 'map',
  HELP: 'help',
};

export function makeState() {
  return {
    mode: ST.FLIGHT,
    view: 'cockpit',      // cockpit | chase
    messages: [],
    paused: false,
  };
}

export function say(state, text, color = null, ttl = 4.5) {
  // Не дублируем одно и то же сообщение подряд.
  const last = state.messages[state.messages.length - 1];
  if (last && last.text === text) { last.t = ttl; return; }
  state.messages.push({ text, color, t: ttl });
  if (state.messages.length > 5) state.messages.shift();
}

export function updateMessages(state, dt) {
  for (const m of state.messages) m.t -= dt;
  state.messages = state.messages.filter((m) => m.t > 0);
}

export const isFlying = (state) => state.mode === ST.FLIGHT;
