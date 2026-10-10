// Ways to find things on the screen that several test files share.
import { act, screen } from "@testing-library/react-native";

/** The headlines of the rows that are drawn, top to bottom. */
export function rowTitles(): string[] {
  return screen.getAllByTestId(/^title-\d+$/).map((node) => String(node.props.children));
}

/** The articles the list holds, drawn or not: a long list draws only the rows near the screen. */
export function listData<T = { id: number; title: string; isRead: boolean }>(): T[] {
  const list = screen.getByTestId("article-list");
  const sections = list.props.sections as Array<{ data: T[] }> | undefined;
  return sections ? sections.flatMap((section) => section.data) : (list.props.data as T[]);
}

export const MINUTE = 60_000;

/** Repeats a check that asks the server until it holds, for up to about eight seconds. */
export async function eventually(check: () => Promise<void> | void, tries = 160): Promise<void> {
  let failure: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      await check();
      return;
    } catch (error) {
      failure = error;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
  throw failure;
}
