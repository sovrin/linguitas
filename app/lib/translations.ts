/** How a project's translations are read, for the snippets on its pages. */
export const deliveryPath = (projectId: string, ...parts: string[]) =>
  ['/v1/translations', projectId, ...parts].join('/')
