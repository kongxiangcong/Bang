export const STRUCTURE_RULES={
 version:1,revision:2,compiler:'bang-structure-1',
 relations:{classification:'Explicit parent category → member/subcategory. Use kind=classification only when that meaning is present in the completed discussion; labels alone never prove it.',general:'Cross references, support, causal links, and feedback remain general relations. Cycles and extra parents are retained, never deleted to fit a tree.'},
 choice:'Prefer committed user structure. For new knowledge only: classification shows explicit categorical depth; radial places a central knowledge topic and its explicitly classified branches around it. If meaning is uncertain, omit structure and retain free layout. Visual groups and annotations are not evidence.',
 schema:{card:'Optional structure:{version:1,kind:classification|radial,rootId:knowledge-card-id}. Each member including root declares the same intent. No coordinates.',relation:'Optional kind:classification|general. Omission never infers classification from labels.'},
 migration:'Version 1 only. Existing cards without structure remain free. No implicit migration, no change to existing user intent. Changing structure requires explicit user choice and draft preview before save.',
 examples:[
  {discussion:'Compare A and B on cost and latency. Only A has a latency measurement.',choice:'comparison',reason:'Declare explicit dimensions and option/dimension on each original knowledge card. Missing B latency remains unknown, never create a value or choose a winner.'},
  {discussion:'We discussed a January test in June; release date is unknown.',choice:'timeline',reason:'eventTime is the explicitly stated event date, never utterance/ingestion time. Unknown stays null; retain imprecise time and conditions in original text without guessing precision.'},
  {discussion:'B was mentioned last so it must be best; yesterday we discussed an undated event.',choice:'free',reason:'Mention order proves neither a winner nor an event time.'},
  {discussion:'Storage categories include volatile memory and persistent storage.',choice:'classification',reason:'Explicit category/member statements establish a parent-to-child backbone; no performance or causality is inferred.'},
  {discussion:'Show these explicit subtopics around the central project concept.',choice:'radial',reason:'A central topic and its named branches justify radial presentation. Cross-topic feedback remains a general edge.'},
  {discussion:'These notes were dragged into the same box.',choice:'free',reason:'A visual group says nothing about classification; do not fabricate parent relations.'},
  {discussion:'A supports B and B feeds back to A.',choice:'free',reason:'Support and feedback are not category membership. Retain both edges, including the cycle.'}
 ],
 comparison:'Each card structure:{version:1,kind:"comparison",rootId,dimensions:[explicit evaluation labels],option:string|null,dimension:string|null}. All members share dimensions; root is an existing/new knowledge card. Null marks unassigned. Do not manufacture empty-cell facts, scores, or winners. Conditions and sources stay on original cards.',
 timeline:'Each card structure:{version:1,kind:"timeline",rootId,eventTime:string|null}. Explicit ISO calendar date YYYY-MM-DD or UTC timestamp only. Partial, relative, ambiguous or unknown time stays null with original wording retained; never substitute utterance time. Layout shows ordinal event order, not elapsed-duration scale.',
 extensionMigration:'Revision 2 adds comparison and timeline to version 1 without changing existing intents. New cards may join a committed structure only with its existing kind/root/dimensions. Existing user choices cannot be overwritten.'
};
