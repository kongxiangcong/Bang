export const STRUCTURE_RULES={
 version:1,compiler:'bang-structure-1',
 relations:{classification:'Explicit parent category → member/subcategory. Use kind=classification only when that meaning is present in the completed discussion; labels alone never prove it.',general:'Cross references, support, causal links, and feedback remain general relations. Cycles and extra parents are retained, never deleted to fit a tree.'},
 choice:'Prefer committed user structure. For new knowledge only: classification shows explicit categorical depth; radial places a central knowledge topic and its explicitly classified branches around it. If meaning is uncertain, omit structure and retain free layout. Visual groups and annotations are not evidence.',
 schema:{card:'Optional structure:{version:1,kind:classification|radial,rootId:knowledge-card-id}. Each member including root declares the same intent. No coordinates.',relation:'Optional kind:classification|general. Omission never infers classification from labels.'},
 migration:'Version 1 only. Existing cards without structure remain free. No implicit migration, no change to existing user intent. Changing structure requires explicit user choice and draft preview before save.',
 examples:[
  {discussion:'Storage categories include volatile memory and persistent storage.',choice:'classification',reason:'Explicit category/member statements establish a parent-to-child backbone; no performance or causality is inferred.'},
  {discussion:'Show these explicit subtopics around the central project concept.',choice:'radial',reason:'A central topic and its named branches justify radial presentation. Cross-topic feedback remains a general edge.'},
  {discussion:'These notes were dragged into the same box.',choice:'free',reason:'A visual group says nothing about classification; do not fabricate parent relations.'},
  {discussion:'A supports B and B feeds back to A.',choice:'free',reason:'Support and feedback are not category membership. Retain both edges, including the cycle.'}
 ]
};
