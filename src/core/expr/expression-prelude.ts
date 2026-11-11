/** SPDX-License-Identifier: MIT
 * Ordinary source/test builds bundle their own core. Production replaces this
 * module with the shared self-contained syntax factory at the build boundary.
 */
export const expressionPrelude = () => '';
