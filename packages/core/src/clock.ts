/** The current time. Injected everywhere a decision depends on "now", so tests can move it. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
