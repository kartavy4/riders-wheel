const STORAGE_KEY = "dick-riders-movie-wheel";
const HISTORY_KEY = "dick-riders-movie-history";
const SETTINGS_KEY = "dick-riders-movie-settings";
const BATTLE_KEY = "dick-riders-battle-state";

const segmentStyles = [
  { fill: "#ff4f7b", text: "#111217", swatch: "#ff4f7b" },
  { fill: "#ffc857", text: "#111217", swatch: "#ffc857" },
  { fill: "#2dd4bf", text: "#111217", swatch: "#2dd4bf" },
  { fill: "#5da9ff", text: "#111217", swatch: "#5da9ff" },
  { fill: "#8ee66b", text: "#111217", swatch: "#8ee66b" },
  { fill: "#8b5cf6", text: "#ffffff", swatch: "#8b5cf6" },
  { fill: "#ffffff", text: "#111217", swatch: "#ffffff" },
];

const wheel = document.querySelector("#wheel");
const ctx = wheel.getContext("2d");
const form = document.querySelector("#movieForm");
const titleInput = document.querySelector("#movieTitle");
const genreInput = document.querySelector("#movieGenre");
const ownerInput = document.querySelector("#movieOwner");
const movieList = document.querySelector("#movieList");
const historyList = document.querySelector("#historyList");
const eliminatedList = document.querySelector("#eliminatedList");
const movieCount = document.querySelector("#movieCount");
const survivorCount = document.querySelector("#survivorCount");
const eliminatedCount = document.querySelector("#eliminatedCount");
const winnerTitle = document.querySelector("#winnerTitle");
const winnerMeta = document.querySelector("#winnerMeta");
const resultLabel = document.querySelector("#resultLabel");
const modeBadge = document.querySelector("#modeBadge");
const modeHint = document.querySelector("#modeHint");
const battlePanel = document.querySelector("#battlePanel");
const importDropZone = document.querySelector("#importDropZone");
const importFileInput = document.querySelector("#importFileInput");
const importSummary = document.querySelector("#importSummary");
const spinButton = document.querySelector("#spinButton");
const shuffleButton = document.querySelector("#shuffleButton");
const clearButton = document.querySelector("#clearButton");
const clearHistoryButton = document.querySelector("#clearHistoryButton");
const resetBattleButton = document.querySelector("#resetBattleButton");
const spinDurationInput = document.querySelector("#spinDuration");
const spinDurationValue = document.querySelector("#spinDurationValue");
const modeInputs = document.querySelectorAll("input[name='wheelMode']");
const toast = document.querySelector("#toast");

let movies = normalizeMovies(load(STORAGE_KEY, []));
let history = load(HISTORY_KEY, []);
let settings = normalizeSettings(load(SETTINGS_KEY, { spinSeconds: 5, mode: "classic" }));
let battle = normalizeBattle(load(BATTLE_KEY, { eliminatedIds: [] }));
let rotation = 0;
let spinning = false;

function createMovie(title, genre = "", owner = "") {
  return {
    id: crypto.randomUUID(),
    title,
    genre,
    owner,
  };
}

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeMovies(items) {
  return Array.isArray(items)
    ? items
        .filter((movie) => movie && typeof movie.title === "string")
        .map((movie) => ({
          id: movie.id || crypto.randomUUID(),
          title: movie.title,
          genre: movie.genre || "",
          owner: movie.owner || "",
        }))
    : [];
}

function normalizeSettings(value) {
  return {
    spinSeconds: clampSpinSeconds(value?.spinSeconds ?? 5),
    mode: value?.mode === "battle" ? "battle" : "classic",
  };
}

function normalizeBattle(value) {
  return {
    eliminatedIds: Array.isArray(value?.eliminatedIds) ? value.eliminatedIds : [],
  };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(movies));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  localStorage.setItem(BATTLE_KEY, JSON.stringify(battle));
}

function clampSpinSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.min(60, Math.max(2, number));
}

function formatSeconds(value) {
  return `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} сек`;
}

function updateDurationUI() {
  settings.spinSeconds = clampSpinSeconds(settings.spinSeconds);
  spinDurationInput.value = settings.spinSeconds;
  spinDurationValue.textContent = formatSeconds(settings.spinSeconds);
  wheel.style.setProperty("--spin-duration", `${settings.spinSeconds}s`);
}

function updateModeUI() {
  modeInputs.forEach((input) => {
    input.checked = input.value === settings.mode;
  });

  const isBattle = settings.mode === "battle";
  battlePanel.classList.toggle("active", isBattle);
  modeBadge.textContent = isBattle ? "Королевская битва" : "Обычный режим";
  modeHint.textContent = isBattle ? "Каждый спин выкидывает один фильм" : "Один спин выбирает фильм";
  resultLabel.textContent = isBattle ? "Раунд на выбывание" : "Выбор на вечер";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2300);
}

function movieMeta(movie) {
  return [movie.genre, movie.owner && `добавил ${movie.owner}`].filter(Boolean).join(" · ") || "Без дополнительных заметок";
}

async function importMoviesFromFile(file) {
  const name = file.name.toLowerCase();
  let text = "";

  if (name.endsWith(".docx")) {
    text = await extractDocxText(file);
  } else if (name.endsWith(".txt") || name.endsWith(".text")) {
    text = await file.text();
  } else if (name.endsWith(".doc")) {
    throw new Error("Старый формат .doc не поддерживается. Сохраните файл как .docx.");
  } else {
    throw new Error("Поддерживаются только .docx и .txt.");
  }

  const imported = parseMovieList(text);
  if (imported.length === 0) {
    throw new Error("В документе не нашел строк с фильмами.");
  }

  const existingTitles = new Set(movies.map((movie) => movie.title.trim().toLowerCase()));
  const fresh = imported.filter((movie) => !existingTitles.has(movie.title.trim().toLowerCase()));

  if (fresh.length === 0) {
    importSummary.textContent = "Новых фильмов нет";
    showToast("Все фильмы из файла уже есть в списке.");
    return;
  }

  movies.push(...fresh);
  importSummary.textContent = `Добавлено: ${fresh.length}`;
  showToast(`Добавлено фильмов: ${fresh.length}`);
  render();
}

function parseMovieList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[\).\-\s])\s*/u, "").trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*[|;\t]\s*/).map((part) => part.trim()).filter(Boolean);
      return createMovie(parts[0] || line, parts[1] || "", parts[2] || "");
    })
    .filter((movie) => movie.title.length > 0);
}

async function extractDocxText(file) {
  try {
    const response = await fetch(`/api/import?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Сервер не смог разобрать .docx.");
    }

    return payload.text || "";
  } catch (serverError) {
    if (!("DecompressionStream" in window)) {
      throw new Error(
        `${serverError.message || "Не получилось разобрать .docx."} Запустите сайт через node work/static-server.mjs и попробуйте снова.`,
      );
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const xmlBytes = await readZipEntry(bytes, "word/document.xml");
  const xml = new TextDecoder("utf-8").decode(xmlBytes);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = Array.from(doc.getElementsByTagNameNS("*", "p"));

  return paragraphs
    .map((paragraph) =>
      Array.from(paragraph.getElementsByTagNameNS("*", "t"))
        .map((node) => node.textContent || "")
        .join("")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

async function readZipEntry(bytes, targetName) {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) throw new Error("Не смог прочитать .docx как ZIP-архив.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const decoder = new TextDecoder("utf-8");
  let offset = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));

    if (name === targetName) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);

      if (method === 0) return compressed;
      if (method === 8) return inflateRaw(compressed);
      throw new Error("Этот .docx использует неподдерживаемое сжатие.");
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error("В .docx не найден основной документ Word.");
}

function findEndOfCentralDirectory(bytes) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 66000); offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  return -1;
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("Браузер не умеет распаковывать .docx без библиотеки. Попробуйте .txt.");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function getActiveMovies() {
  if (settings.mode !== "battle") return movies;
  const eliminated = new Set(battle.eliminatedIds);
  return movies.filter((movie) => !eliminated.has(movie.id));
}

function cleanupBattleState() {
  const ids = new Set(movies.map((movie) => movie.id));
  battle.eliminatedIds = battle.eliminatedIds.filter((id) => ids.has(id));
}

function resetBattleRound() {
  battle.eliminatedIds = [];
  winnerTitle.textContent = "Королевская битва началась.";
  winnerMeta.textContent = "Крутите колесо: выбранный фильм вылетает, последний оставшийся побеждает.";
  render();
}

function render() {
  cleanupBattleState();
  const activeMovies = getActiveMovies();
  const isBattle = settings.mode === "battle";

  movieCount.textContent = isBattle
    ? `${activeMovies.length} осталось из ${movies.length}`
    : `${movies.length} ${getMovieWord(movies.length)}`;

  survivorCount.textContent = activeMovies.length;
  eliminatedCount.textContent = battle.eliminatedIds.length;

  movieList.innerHTML = "";
  movies.forEach((movie, index) => {
    const style = getSegmentStyle(index);
    const isEliminated = isBattle && battle.eliminatedIds.includes(movie.id);
    const li = document.createElement("li");
    li.className = `movie-card${isEliminated ? " eliminated" : ""}`;
    li.innerHTML = `
      <span class="swatch" style="background:${style.swatch}"></span>
      <span>
        <span class="movie-title">${escapeHtml(movie.title)}</span>
        <span class="movie-meta">${escapeHtml(isEliminated ? `вылетел · ${movieMeta(movie)}` : movieMeta(movie))}</span>
      </span>
      <button class="remove-button" type="button" aria-label="Удалить ${escapeHtml(movie.title)}" data-index="${index}">×</button>
    `;
    movieList.appendChild(li);
  });

  eliminatedList.innerHTML = "";
  battle.eliminatedIds
    .map((id) => movies.find((movie) => movie.id === id))
    .filter(Boolean)
    .forEach((movie) => {
      const li = document.createElement("li");
      li.textContent = movie.title;
      eliminatedList.appendChild(li);
    });

  historyList.innerHTML = "";
  history.slice(0, 10).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.mode === "battle" ? "Битва" : "Выбор"} · ${item.title}${item.genre ? ` · ${item.genre}` : ""}`;
    historyList.appendChild(li);
  });

  spinButton.disabled = spinning || activeMovies.length < 2;
  updateModeUI();
  drawWheel(activeMovies);
  save();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getMovieWord(count) {
  const abs = Math.abs(count);
  const lastTwo = abs % 100;
  const last = abs % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return "фильмов";
  if (last === 1) return "фильм";
  if (last >= 2 && last <= 4) return "фильма";
  return "фильмов";
}

function getSegmentStyle(index) {
  return segmentStyles[index % segmentStyles.length];
}

function drawWheel(wheelMovies = getActiveMovies()) {
  const size = wheel.width;
  const center = size / 2;
  const radius = center - 30;
  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.translate(center, center);

  ctx.beginPath();
  ctx.arc(0, 0, radius + 24, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#111217";
  ctx.lineWidth = 12;
  ctx.stroke();

  if (wheelMovies.length === 0) {
    drawEmptyWheel(radius);
  } else {
    const arc = (Math.PI * 2) / wheelMovies.length;
    wheelMovies.forEach((movie, index) => {
      const style = getSegmentStyle(index);
      const start = index * arc - Math.PI / 2;
      const end = start + arc;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = style.fill;
      ctx.fill();
      drawSegmentDivider(start, radius);

      ctx.save();
      ctx.rotate(start + arc / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = style.text;
      ctx.font = `900 ${wheelMovies.length > 9 ? 25 : 31}px Inter, system-ui, sans-serif`;
      const label = movie.title.length > 24 ? `${movie.title.slice(0, 23)}...` : movie.title;
      ctx.fillText(label, radius - 36, 11);
      ctx.restore();
    });
  }

  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.23, 0, Math.PI * 2);
  ctx.fillStyle = "#111217";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 12;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "950 54px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DR", 0, -4);
  ctx.restore();
}

function drawSegmentDivider(angle, radius) {
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(radius, 0);
  ctx.strokeStyle = "rgba(17, 18, 23, 0.36)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawEmptyWheel(radius) {
  const rings = 12;
  for (let index = 0; index < rings; index += 1) {
    const style = getSegmentStyle(index);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, (Math.PI * 2 * index) / rings - Math.PI / 2, (Math.PI * 2 * (index + 1)) / rings - Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = style.fill;
    ctx.fill();
    drawSegmentDivider((Math.PI * 2 * index) / rings - Math.PI / 2, radius);
  }

  ctx.fillStyle = "#111217";
  ctx.font = "900 36px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ДОБАВЬТЕ ФИЛЬМЫ", 0, -88);
  ctx.font = "720 25px Inter, system-ui, sans-serif";
  ctx.fillText("Dick Riders решают вместе", 0, -48);
}

function spin() {
  const activeMovies = getActiveMovies();
  if (spinning || activeMovies.length < 2) {
    showToast(settings.mode === "battle" ? "Для битвы нужны хотя бы два оставшихся фильма." : "Сначала добавьте хотя бы два фильма.");
    return;
  }

  spinning = true;
  spinButton.disabled = true;
  updateDurationUI();

  const spinMs = settings.spinSeconds * 1000;
  const selectedIndex = Math.floor(Math.random() * activeMovies.length);
  const segment = 360 / activeMovies.length;
  const centerOfSelected = selectedIndex * segment + segment / 2;
  const targetAtPointer = 360 - centerOfSelected;
  const extraTurns = Math.max(4, Math.round(settings.spinSeconds * 0.38)) + Math.floor(Math.random() * 3);
  rotation += extraTurns * 360 + targetAtPointer - (rotation % 360);

  wheel.style.setProperty("--wheel-rotation", `${rotation}deg`);

  window.setTimeout(() => {
    const selectedMovie = activeMovies[selectedIndex];

    if (settings.mode === "battle") {
      battle.eliminatedIds.push(selectedMovie.id);
      const survivors = getActiveMovies();

      if (survivors.length === 1) {
        const champion = survivors[0];
        winnerTitle.textContent = `Победитель: ${champion.title}`;
        winnerMeta.textContent = `Последний выживший · ${movieMeta(champion)}`;
        history.unshift({ ...champion, mode: "battle", wonAt: new Date().toISOString() });
        showToast(`Победитель битвы: ${champion.title}`);
      } else {
        winnerTitle.textContent = `Вылетел: ${selectedMovie.title}`;
        winnerMeta.textContent = `${survivors.length} ${getMovieWord(survivors.length)} еще держатся.`;
        showToast(`Вылетел: ${selectedMovie.title}`);
      }
    } else {
      winnerTitle.textContent = selectedMovie.title;
      winnerMeta.textContent = movieMeta(selectedMovie);
      history.unshift({ ...selectedMovie, mode: "classic", wonAt: new Date().toISOString() });
      showToast(`Dick Riders выбрали: ${selectedMovie.title}`);
    }

    history = history.slice(0, 20);
    spinning = false;
    render();
  }, spinMs + 120);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;

  movies.push(createMovie(title, genreInput.value.trim(), ownerInput.value.trim()));
  form.reset();
  titleInput.focus();
  render();
});

importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files?.[0];
  if (!file) return;

  try {
    await importMoviesFromFile(file);
  } catch (error) {
    importSummary.textContent = "Ошибка импорта";
    showToast(error.message || "Не получилось импортировать файл.");
  } finally {
    importFileInput.value = "";
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  importDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    importDropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  importDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    importDropZone.classList.remove("dragging");
  });
});

importDropZone.addEventListener("drop", async (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  try {
    await importMoviesFromFile(file);
  } catch (error) {
    importSummary.textContent = "Ошибка импорта";
    showToast(error.message || "Не получилось импортировать файл.");
  }
});

movieList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-index]");
  if (!button || spinning) return;
  const [removed] = movies.splice(Number(button.dataset.index), 1);
  battle.eliminatedIds = battle.eliminatedIds.filter((id) => id !== removed.id);
  render();
});

spinButton.addEventListener("click", spin);

spinDurationInput.addEventListener("input", () => {
  settings.spinSeconds = clampSpinSeconds(spinDurationInput.value);
  updateDurationUI();
  save();
});

modeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    settings.mode = input.value;
    updateModeUI();
    render();
  });
});

shuffleButton.addEventListener("click", () => {
  movies = movies
    .map((movie) => ({ movie, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ movie }) => movie);
  render();
});

clearButton.addEventListener("click", () => {
  if (spinning) return;
  movies = [];
  battle.eliminatedIds = [];
  winnerTitle.textContent = "Заряжайте колесо, и пусть решает судьба.";
  winnerMeta.textContent = "Добавьте хотя бы два фильма, потом крутите.";
  render();
});

clearHistoryButton.addEventListener("click", () => {
  history = [];
  render();
});

resetBattleButton.addEventListener("click", resetBattleRound);

window.addEventListener("resize", () => drawWheel());

updateDurationUI();
updateModeUI();
render();
