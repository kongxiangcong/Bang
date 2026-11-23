const byId = (id) => document.getElementById(id);
const kinds = { question: '问题', concept: '概念', claim: '结论', evidence: '依据' };
const statuses = { resolved: '已解答', superseded: '已修正', qualified: '有成立条件', disputed: '有争议' };
const topicSelect = byId('topics');
const cards = byId('landmarks');
const canvas = byId('connections');
const details = byId('details');
const content = byId('detail-content');
const search = byId('search');
const episodeDialog = byId('episode-dialog');
const episodeContent = byId('episode-content');
const cardElements = new Map();
let endpoint;
let board;
let selected;
let shownEpisode;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action, className) {
  const control = element('button', text, className);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

async function read(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`请求失败（${response.status}）`);
  return response.json();
}

function showStatus(message) {
  const status = byId('status');
  status.textContent = message;
  status.hidden = !message;
}

function drawConnections() {
  const { width, height, left, top } = cards.getBoundingClientRect();
  const resolution = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(width * resolution);
  canvas.height = Math.ceil(height * resolution);
  const context = canvas.getContext('2d');
  if (!context || !board) return;
  context.scale(resolution, resolution);
  const center = (card) => {
    const rect = card.getBoundingClientRect();
    return { x: rect.left - left + rect.width / 2, y: rect.top - top + rect.height / 2,
      width: rect.width, height: rect.height };
  };
  for (const edge of board.knowledge.edges) {
    const fromCard = cardElements.get(edge.from);
    const toCard = cardElements.get(edge.to);
    if (!fromCard || !toCard || fromCard === toCard) continue;
    const from = center(fromCard);
    const to = center(toCard);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const a = Math.min(from.width / (2 * Math.abs(dx)), from.height / (2 * Math.abs(dy)));
    const b = Math.min(to.width / (2 * Math.abs(dx)), to.height / (2 * Math.abs(dy)));
    const targetX = to.x - dx * b;
    const targetY = to.y - dy * b;
    const angle = Math.atan2(dy, dx);
    const emphasized = [edge.from, edge.to].includes(selected);
    context.strokeStyle = emphasized ? '#4c6b59' : '#a1aca2';
    context.lineWidth = emphasized ? 2 : 1;
    context.setLineDash(edge.provenance === 'INFERRED' ? [5, 4] : []);
    context.beginPath();
    context.moveTo(from.x + dx * a, from.y + dy * a);
    context.lineTo(targetX, targetY);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(targetX - 7 * Math.cos(angle - 0.5), targetY - 7 * Math.sin(angle - 0.5));
    context.lineTo(targetX, targetY);
    context.lineTo(targetX - 7 * Math.cos(angle + 0.5), targetY - 7 * Math.sin(angle + 0.5));
    context.stroke();
  }
}

function renderBoard() {
  const query = search.value.trim().toLocaleLowerCase();
  cards.replaceChildren();
  cardElements.clear();
  for (const node of board.knowledge.nodes) {
    if (query && ![node.title, node.detail, ...node.conditions].join(' ').toLocaleLowerCase().includes(query)) continue;
    const card = button(undefined, () => selectNode(node.id), 'landmark');
    card.dataset.kind = node.kind;
    card.setAttribute('aria-pressed', node.id === selected);
    const label = [kinds[node.kind], statuses[node.status]].filter(Boolean).join(' · ');
    card.append(element('span', label, 'kind'), element('strong', node.title));
    cards.append(card);
    cardElements.set(node.id, card);
  }
  showStatus(query && !cardElements.size ? '没有匹配的路标' : '');
  drawConnections();
}

function appendSources(target, ids) {
  if (!ids.length) return;
  const list = element('ul', undefined, 'sources');
  for (const id of new Set(ids)) {
    const item = element('li');
    item.append(button(`查看原文 ${id.slice(0, 8)}`, () => showEpisode(id), 'text-button'));
    list.append(item);
  }
  target.append(list);
}

function selectNode(id) {
  selected = id;
  const node = board.knowledge.nodes.find((item) => item.id === id);
  details.hidden = !node;
  if (!node) selected = undefined;
  if (node) {
    content.replaceChildren(element('h2', node.title), element('p', node.detail, 'prose'));
    if (node.conditions.length) {
      const conditions = element('ul');
      for (const condition of node.conditions) conditions.append(element('li', condition));
      content.append(element('h3', '成立条件'), conditions);
    }
    const state = board.epistemic.nodes.find(({ node_id }) => node_id === id);
    if (state?.belief_history.length) {
      content.append(element('h3', '理解变化'));
      for (const shift of state.belief_history) {
        content.append(element('p', shift.previous_belief), element('p', shift.correction));
        appendSources(content, [shift.trigger_episode_id]);
      }
    }
    appendSources(content, node.source_episodes);
    const edges = board.knowledge.edges.filter((edge) => edge.from === id || edge.to === id);
    if (edges.length) content.append(element('h3', '关联路标'));
    for (const edge of edges) {
      const relatedId = edge.from === id ? edge.to : edge.from;
      const related = board.knowledge.nodes.find((item) => item.id === relatedId);
      if (!related) continue;
      const relation = element('section', undefined, 'relation');
      const side = edge.from === id ? '指向' : '来自';
      const provenance = edge.provenance === 'INFERRED' ? '推断' : '明示';
      relation.append(element('p', `${edge.predicate} · ${provenance} · ${side}`),
        button(related.title, () => selectNode(relatedId), 'text-button'));
      appendSources(relation, edge.source_episodes);
      content.append(relation);
    }
    details.scrollTop = 0;
  }
  for (const [cardId, card] of cardElements) card.setAttribute('aria-pressed', cardId === selected);
  drawConnections();
}

function episodeView(title) {
  byId('episode-title').textContent = title;
  episodeContent.replaceChildren();
  if (!episodeDialog.open) episodeDialog.showModal();
}

async function showEpisode(id) {
  shownEpisode = id;
  episodeView('原始问答');
  episodeContent.append(element('p', '正在读取原文…'));
  try {
    const episode = await read(`${endpoint}/episodes/${encodeURIComponent(id)}`);
    if (shownEpisode !== id) return;
    episodeContent.replaceChildren(element('p', `${episode.sourceTool} · ${episode.sessionId}`, 'meta'),
      element('p', episode.id, 'meta'));
    for (const message of episode.messages) {
      episodeContent.append(element('h3', message.role === 'user' ? '用户提问' : '助手回答'),
        element('p', message.content, 'prose'));
    }
  } catch (error) {
    if (shownEpisode === id) episodeContent.replaceChildren(element('p', error.message));
  }
}

async function listEpisodes() {
  shownEpisode = undefined;
  episodeView('原文记录');
  episodeContent.append(element('p', '正在读取原文…'));
  try {
    const { episodes } = await read(`${endpoint}/episodes`);
    if (shownEpisode !== undefined || !episodeDialog.open) return;
    episodeContent.replaceChildren();
    if (!episodes.length) episodeContent.append(element('p', '暂无已保存的原文'));
    const list = element('ul', undefined, 'episode-list');
    for (const episode of episodes) {
      const item = element('li');
      const question = episode.messages[0]?.content ?? episode.id;
      item.append(button(question, () => showEpisode(episode.id), 'text-button'));
      item.append(element('p', `${episode.sourceTool} · ${episode.occurredAt}`, 'meta'));
      list.append(item);
    }
    episodeContent.append(list);
  } catch (error) {
    if (shownEpisode === undefined) episodeContent.replaceChildren(element('p', error.message));
  }
}

async function refresh() {
  try {
    const fresh = await read(`${endpoint}/board`);
    if (!board || JSON.stringify(fresh.knowledge) !== JSON.stringify(board.knowledge) ||
        JSON.stringify(fresh.epistemic) !== JSON.stringify(board.epistemic)) {
      board = fresh;
      renderBoard();
      if (selected) selectNode(selected);
    } else if (byId('status').dataset.connectionError) {
      showStatus('');
    }
    delete byId('status').dataset.connectionError;
  } catch {
    byId('status').dataset.connectionError = 'true';
    showStatus('无法连接白板服务，正在尝试恢复…');
  } finally {
    setTimeout(refresh, 4000);
  }
}

async function start() {
  const { topics, activeTopicId } = await read('/api/topics');
  const slug = new URLSearchParams(window.location.search).get('topic');
  const topic = slug ? topics.find((item) => item.slug === slug)
    : topics.find((item) => item.id === activeTopicId) ?? topics[0];
  if (!topic) {
    if (slug) showStatus('找不到此专题');
    return;
  }
  for (const item of topics) topicSelect.add(new Option(item.title, item.slug, false, topic.id === item.id));
  topicSelect.hidden = false;
  search.hidden = false;
  byId('episodes').hidden = false;
  document.title = `${topic.title} · Bang`;
  endpoint = `/api/topics/${encodeURIComponent(topic.id)}`;
  await refresh();
}

topicSelect.addEventListener('change', () => {
  window.location.search = new URLSearchParams({ topic: topicSelect.value }).toString();
});
search.addEventListener('input', () => { if (board) renderBoard(); });
byId('close-details').addEventListener('click', () => selectNode(undefined));
byId('episodes').addEventListener('click', listEpisodes);
new ResizeObserver(drawConnections).observe(cards);
start().catch((error) => showStatus(error.message));
