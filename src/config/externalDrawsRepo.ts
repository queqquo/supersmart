/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Configurazione del repository GitHub esterno dedicato allo storico delle estrazioni.
 * Tenere gli storici fuori dal repository dell'app evita che AI Studio carichi centinaia
 * di KB di dati storici nel contesto ad ogni modifica.
 */

export const EXTERNAL_DRAWS_REPO_OWNER = 'queqquo';
export const EXTERNAL_DRAWS_REPO_NAME = 'supersmart-storico-estrazioni';
export const EXTERNAL_DRAWS_REPO_BRANCH = 'main';

export const EXTERNAL_DRAWS_REPO_URL = `https://github.com/${EXTERNAL_DRAWS_REPO_OWNER}/${EXTERNAL_DRAWS_REPO_NAME}`;

export const EXTERNAL_SUPERENALOTTO_PATH = 'data/superenalotto.json';
export const EXTERNAL_WINFORITALIA_PATH = 'data/winforitalia.json';

export const EXTERNAL_SUPERENALOTTO_RAW_URL = `https://raw.githubusercontent.com/${EXTERNAL_DRAWS_REPO_OWNER}/${EXTERNAL_DRAWS_REPO_NAME}/${EXTERNAL_DRAWS_REPO_BRANCH}/${EXTERNAL_SUPERENALOTTO_PATH}`;
export const EXTERNAL_WINFORITALIA_RAW_URL = `https://raw.githubusercontent.com/${EXTERNAL_DRAWS_REPO_OWNER}/${EXTERNAL_DRAWS_REPO_NAME}/${EXTERNAL_DRAWS_REPO_BRANCH}/${EXTERNAL_WINFORITALIA_PATH}`;
