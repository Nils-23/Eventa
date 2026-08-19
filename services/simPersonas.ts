/**
 * The admin's fixed roster of simulated chat personas.
 *
 * These ten identities are the ONLY simulated users an admin can post as. The
 * roster is fixed (and the ids are stable constants) so the admin can leave a
 * persona, speak as another, and come back later to continue the first
 * conversation — with randomly minted personas the old identity was
 * unrecoverable once you switched away.
 *
 * Id shape: `sim_admin_<slot>_<number>`.
 *  - The `sim_admin_` prefix keeps these distinct from seeded AI personas
 *    (`persona_*`) and real Firebase UIDs, and exempts them from the stale
 *    presence pruning in functions/index.js (they are human-driven).
 *  - The numeric tail is chosen so that even code paths that never consult this
 *    roster — the generic `sim_` fallback in fetchUsername, which indexes a
 *    14-name pool by `number % 14` — derive exactly the same display name.
 *    Keep that property if you ever renumber a slot.
 */
export interface SimPersona {
  id: string;
  name: string;
}

export const SIM_PERSONAS: SimPersona[] = [
  { id: 'sim_admin_slot01_4424', name: 'NightOwl4424' },
  { id: 'sim_admin_slot02_6609', name: 'PartyAnimal6609' },
  { id: 'sim_admin_slot03_2256', name: 'VibeCheck2256' },
  { id: 'sim_admin_slot04_7745', name: 'Raver7745' },
  { id: 'sim_admin_slot05_3168', name: 'ClubHopper3168' },
  { id: 'sim_admin_slot06_5101', name: 'MidnightRider5101' },
  { id: 'sim_admin_slot07_8882', name: 'NeonSoul8882' },
  { id: 'sim_admin_slot08_1435', name: 'BassDrop1435' },
  { id: 'sim_admin_slot09_6532', name: 'GrooveMaster6532' },
  { id: 'sim_admin_slot10_2095', name: 'MoonlightViber2095' },
];

/** The persona selected by default the first time an admin posts as simulated. */
export const DEFAULT_SIM_PERSONA = SIM_PERSONAS[0];

/** Returns the roster entry for an id, or undefined for ids outside the roster. */
export const getSimPersona = (id: string): SimPersona | undefined =>
  SIM_PERSONAS.find((p) => p.id === id);
