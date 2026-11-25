// Showboard: a TV show explorer built on the public TVmaze API (https://www.tvmaze.com/api).
//
// API calls used:
//   GET /schedule?country=XX                      episodes airing today in a country (home page)
//   GET /search/shows?q=NAME                      shows matching a search
//   GET /shows/ID?embed[]=episodes&embed[]=cast&embed[]=nextepisode
//                                                 one call that returns the show plus all its
//                                                 episodes, cast and next episode (show page)
// No API key is needed and the API allows requests from the browser (CORS).
// The watchlist and watched episodes are saved in localStorage, so they stay in this browser.

const API = "https://api.tvmaze.com";
const STORAGE_KEY = "showboard.v1";
const COUNTRIES = { US: "United States", GB: "United Kingdom", DE: "Germany" };
const SUGGESTIONS = ["Breaking Bad", "The Office", "Dark", "Severance", "Friends", "The Bear"];

const app = document.getElementById("app");

// ---------- Small helpers ----------

// Builds a DOM element. Strings become text nodes, so API data is never parsed as HTML.
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== "list") node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

// TVmaze sends summaries as HTML (<p>, <b>, ...). We only keep the plain text.
function plainText(html) {
  return new DOMParser().parseFromString(html || "", "text/html").body.textContent.trim();
}

const year = (date) => (date ? date.slice(0, 4) : "");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const episodeCode = (ep) => `S${String(ep.season).padStart(2, "0")}E${ep.number == null ? "–" : String(ep.number).padStart(2, "0")}`;

// Colour scale for ratings. It is stretched to the current show's weakest and best episode,
// because most shows only range over 1–2 points and a fixed 0–10 scale would look all the same.
const scale = { min: 6, max: 9.5 };

function setScale(ratings) {
  if (ratings.length === 0) return;
  scale.min = Math.min(...ratings);
  scale.max = Math.max(...ratings);
  if (scale.max - scale.min < 1) {
    scale.min -= 0.5;
    scale.max += 0.5;
  }
}

// Maps a rating to a colour from red (this show's weakest) to green (this show's best).
function ratingColor(rating) {
  if (!rating) return null;
  const t = Math.min(1, Math.max(0, (rating - scale.min) / (scale.max - scale.min)));
  return `hsl(${Math.round(t * 130)} 68% 56%)`;
}

// ---------- API with cache and a retry for the rate limit ----------

const cache = new Map();

async function api(path) {
  if (cache.has(path)) return cache.get(path);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(API + path);
    // TVmaze allows about 20 requests per 10 seconds. On "429 Too Many Requests" we wait and retry.
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    if (response.status === 404) throw new Error("Not found");
    if (!response.ok) throw new Error(`TVmaze answered with HTTP ${response.status}`);
    const data = await response.json();
    cache.set(path, data);
    return data;
  }
  throw new Error("TVmaze is busy right now (rate limit). Please try again in a few seconds.");
}

// ---------- Saved data: watchlist and watched episodes ----------

function loadStore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { list: data?.list || {}, watched: data?.watched || {} };
  } catch {
    return { list: {}, watched: {} };
  }
}

let store = loadStore();

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage can be blocked (e.g. private mode). The app still works, it just forgets on reload.
  }
  updateWatchCount();
}

const isSaved = (id) => Boolean(store.list[id]);
const watchedSet = (id) => new Set(store.watched[id] || []);

function toggleSaved(show, episodeCount) {
  if (isSaved(show.id)) {
    delete store.list[show.id];
  } else {
    store.list[show.id] = {
      id: show.id,
      name: show.name,
      image: show.image?.medium || null,
      premiered: show.premiered,
      status: show.status,
      episodes: episodeCount,
      addedAt: Date.now(),
    };
  }
  saveStore();
}

function setWatched(showId, ids) {
  store.watched[showId] = [...ids];
  saveStore();
}

function updateWatchCount() {
  const n = Object.keys(store.list).length;
  document.getElementById("watch-count").textContent = n || "";
}

// ---------- Reusable pieces ----------

function posterBox(image, name, ...overlays) {
  return h(
    "div",
    { class: "poster" },
    image ? h("img", { src: image, alt: "", loading: "lazy" }) : h("div", { class: "noimg" }, name),
    ...overlays
  );
}

function showCard(show, sub, extra = {}) {
  const rating = show.rating?.average;
  return h(
    "a",
    { class: "card", href: `#show/${show.id}`, "aria-label": show.name },
    posterBox(
      show.image?.medium || show.image,
      show.name,
      rating ? h("span", { class: "badge" }, `★ ${rating.toFixed(1)}`) : null,
      extra.progress != null ? h("div", { class: "progress" }, h("i", { style: `width:${extra.progress}%` })) : null
    ),
    h("div", { class: "card-title" }, show.name),
    sub ? h("div", { class: "card-sub" }, sub) : null
  );
}

function skeletonGrid(count = 12) {
  return h(
    "div",
    { class: "grid skeleton", "aria-hidden": "true" },
    Array.from({ length: count }, () => h("div", { class: "card" }, h("div", { class: "poster" })))
  );
}

function stateBox(title, text, isError = false) {
  return h("div", { class: "state" }, h("strong", { class: isError ? "error" : "" }, title), text);
}

function render(...nodes) {
  app.replaceChildren(...nodes.filter(Boolean));
}

// ---------- Views ----------

function searchForm(initial = "") {
  const input = h("input", {
    type: "search",
    name: "q",
    value: initial,
    placeholder: "Search a show, e.g. Breaking Bad",
    "aria-label": "Search TV shows",
    autocomplete: "off",
  });
  const form = h(
    "form",
    {
      class: "search",
      role: "search",
      onsubmit: (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (query) location.hash = `#search/${encodeURIComponent(query)}`;
      },
    },
    input,
    h("button", { class: "btn", type: "submit" }, "Search")
  );
  return { form, input };
}

let scheduleCountry = "US";

async function homeView() {
  const { form, input } = searchForm();
  const suggestions = h(
    "div",
    { class: "suggestions" },
    h("span", { class: "muted", style: "font-size:13px;align-self:center" }, "Try:"),
    SUGGESTIONS.map((name) =>
      h("button", { class: "chip", type: "button", onclick: () => (location.hash = `#search/${encodeURIComponent(name)}`) }, name)
    )
  );

  const tonight = h("section", { class: "section" });
  render(
    h(
      "section",
      { class: "hero" },
      h("h1", {}, "What are you ", h("span", {}, "watching"), " next?"),
      h("p", {}, "Search any TV show, follow its episodes, see which seasons were the best and keep track of what you've watched."),
      form,
      suggestions
    ),
    watchlistPreview(),
    tonight
  );
  input.focus();
  renderTonight(tonight);
}

function watchlistPreview() {
  const saved = Object.values(store.list).sort((a, b) => b.addedAt - a.addedAt);
  if (saved.length === 0) return null;
  return h(
    "section",
    { class: "section" },
    h("div", { class: "section-head" }, h("h2", {}, "Continue watching"), h("a", { href: "#watchlist", class: "muted" }, "See all →")),
    h("div", { class: "grid" }, saved.slice(0, 6).map(savedCard))
  );
}

function savedCard(item) {
  const watched = watchedSet(item.id).size;
  const progress = item.episodes ? Math.round((watched / item.episodes) * 100) : 0;
  return showCard(
    { id: item.id, name: item.name, image: item.image },
    item.episodes ? `${watched} / ${item.episodes} episodes watched` : "Not started",
    { progress }
  );
}

async function renderTonight(section) {
  const chips = h(
    "div",
    { class: "suggestions", style: "margin:0" },
    Object.entries(COUNTRIES).map(([code, name]) =>
      h(
        "button",
        {
          class: "chip",
          type: "button",
          "aria-pressed": String(code === scheduleCountry),
          onclick: () => {
            scheduleCountry = code;
            renderTonight(section);
          },
        },
        name
      )
    )
  );
  const body = skeletonGrid(12);
  section.replaceChildren(h("div", { class: "section-head" }, h("h2", {}, "On TV today"), chips), body);

  try {
    const episodes = await api(`/schedule?country=${scheduleCountry}`);
    // One card per show, the best-rated shows first.
    const byShow = new Map();
    for (const ep of episodes) if (!byShow.has(ep.show.id)) byShow.set(ep.show.id, ep);
    const top = [...byShow.values()]
      .sort((a, b) => (b.show.rating?.average || 0) - (a.show.rating?.average || 0) || b.show.weight - a.show.weight)
      .slice(0, 18);

    if (top.length === 0) {
      body.replaceWith(stateBox("Nothing scheduled", "TVmaze has no episodes listed for today in this country."));
      return;
    }
    body.replaceWith(
      h(
        "div",
        { class: "grid" },
        top.map((ep) => {
          const channel = ep.show.network?.name || ep.show.webChannel?.name || "";
          return showCard(ep.show, [ep.airtime, channel].filter(Boolean).join(" · "));
        })
      )
    );
  } catch (error) {
    body.replaceWith(stateBox("Couldn't load today's schedule", error.message, true));
  }
}

async function searchView(query) {
  const { form } = searchForm(query);
  const results = h("section", { class: "section" }, skeletonGrid(8));
  render(h("section", { class: "hero", style: "padding-bottom:0" }, form), results);

  try {
    const matches = await api(`/search/shows?q=${encodeURIComponent(query)}`);
    if (matches.length === 0) {
      results.replaceChildren(stateBox(`No shows found for “${query}”`, "Check the spelling or try a shorter name."));
      return;
    }
    results.replaceChildren(
      h("div", { class: "section-head" }, h("h2", {}, `${plural(matches.length, "result")} for “${query}”`)),
      h(
        "div",
        { class: "grid" },
        matches.map(({ show }) => showCard(show, [year(show.premiered), show.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ")))
      )
    );
  } catch (error) {
    results.replaceChildren(stateBox("Search failed", error.message, true));
  }
}

function watchlistView() {
  const saved = Object.values(store.list).sort((a, b) => b.addedAt - a.addedAt);
  render(
    h(
      "section",
      { class: "section", style: "margin-top:40px" },
      h("div", { class: "section-head" }, h("h2", {}, "Your watchlist"), h("span", { class: "muted" }, plural(saved.length, "show"))),
      saved.length
        ? h("div", { class: "grid" }, saved.map(savedCard))
        : stateBox("Your watchlist is empty", "Open any show and press “Add to watchlist”.")
    )
  );
}

// ---------- Show page ----------

const showUi = { tab: "episodes", season: null };

async function showView(id, tab) {
  render(h("div", { class: "state" }, "Loading show…"));
  let show;
  try {
    show = await api(`/shows/${id}?embed[]=episodes&embed[]=cast&embed[]=nextepisode`);
  } catch (error) {
    render(stateBox("Couldn't load this show", error.message, true), h("p", { style: "text-align:center" }, h("a", { href: "#" }, "← Back to Discover")));
    return;
  }

  const episodes = show._embedded?.episodes || [];
  const cast = show._embedded?.cast || [];
  const next = show._embedded?.nextepisode;
  const seasons = [...new Set(episodes.map((ep) => ep.season))];
  setScale(episodes.map((ep) => ep.rating?.average).filter(Boolean));
  if (!seasons.includes(showUi.season) || showUi.showId !== show.id) {
    showUi.season = seasons[0] ?? null;
    showUi.tab = "episodes";
    showUi.showId = show.id;
  }
  if (["episodes", "ratings", "cast"].includes(tab)) showUi.tab = tab;
  // Keep the saved episode count up to date for the progress bars.
  if (isSaved(show.id) && store.list[show.id].episodes !== episodes.length) {
    store.list[show.id].episodes = episodes.length;
    saveStore();
  }

  document.title = `${show.name} · Showboard`;
  const statsBox = h("div", { class: "stats" });
  const tabBody = h("div", { role: "tabpanel" });
  const tabs = h("div", { class: "tabs", role: "tablist" });

  function refreshStats() {
    statsBox.replaceChildren(...showStats(show, episodes, seasons));
  }

  function drawTabs() {
    const defs = [
      ["episodes", `Episodes (${episodes.length})`],
      ["ratings", "Ratings map"],
      ["cast", `Cast (${cast.length})`],
    ];
    tabs.replaceChildren(
      ...defs.map(([key, label]) =>
        h(
          "button",
          {
            class: "tab",
            role: "tab",
            type: "button",
            "aria-selected": String(showUi.tab === key),
            onclick: () => {
              showUi.tab = key;
              // Update the address so the tab can be linked, without reloading the show.
              history.replaceState(null, "", `#show/${show.id}/${key}`);
              drawTabs();
            },
          },
          label
        )
      )
    );
    if (showUi.tab === "episodes") tabBody.replaceChildren(episodesTab(show, episodes, seasons, refreshStats));
    if (showUi.tab === "ratings") tabBody.replaceChildren(ratingsTab(episodes, seasons));
    if (showUi.tab === "cast") tabBody.replaceChildren(castTab(cast));
  }

  refreshStats();
  drawTabs();
  render(showHero(show, episodes.length), statsBox, nextEpisodeBox(show, next), tabs, tabBody);
  window.scrollTo(0, 0);
}

function showHero(show, episodeCount) {
  const channel = show.network?.name || show.webChannel?.name;
  const meta = [
    year(show.premiered) && `${year(show.premiered)}${show.ended ? `–${year(show.ended)}` : ""}`,
    channel,
    show.averageRuntime && `${show.averageRuntime} min`,
    ...show.genres,
  ].filter(Boolean);

  const saveBtn = h("button", { class: "btn", type: "button" });
  const drawSave = () => {
    const saved = isSaved(show.id);
    saveBtn.className = saved ? "btn on" : "btn";
    saveBtn.textContent = saved ? "✓ On your watchlist" : "+ Add to watchlist";
  };
  saveBtn.addEventListener("click", () => {
    toggleSaved(show, episodeCount);
    drawSave();
  });
  drawSave();

  return h(
    "section",
    { class: "show-hero" },
    show.image ? h("div", { class: "backdrop", style: `background-image:url("${show.image.original}")` }) : null,
    h(
      "a",
      {
        class: "back",
        href: "#",
        onclick: (event) => {
          // Go back to the previous view (search results, watchlist...) if there is one.
          if (history.length > 1) {
            event.preventDefault();
            history.back();
          }
        },
      },
      "← Back"
    ),
    h(
      "div",
      { class: "show-top" },
      posterBox(show.image?.medium, show.name),
      h(
        "div",
        {},
        h("h1", {}, show.name),
        h(
          "div",
          { class: "meta" },
          show.rating?.average ? h("span", { class: "pill" }, `★ ${show.rating.average.toFixed(1)}`) : null,
          h("span", { class: `pill ${show.status === "Running" ? "live" : ""}` }, show.status === "Running" ? "● Running" : show.status),
          meta.map((m) => h("span", { class: "pill" }, m))
        ),
        h("p", { class: "summary" }, plainText(show.summary) || "No summary available."),
        h(
          "div",
          { class: "actions" },
          saveBtn,
          show.officialSite ? h("a", { class: "btn ghost", href: show.officialSite, target: "_blank", rel: "noopener" }, "Official site ↗") : null,
          h("a", { class: "btn ghost", href: show.url, target: "_blank", rel: "noopener" }, "TVmaze ↗")
        )
      )
    )
  );
}

function showStats(show, episodes, seasons) {
  const rated = episodes.filter((ep) => ep.rating?.average);
  const avg = rated.length ? rated.reduce((sum, ep) => sum + ep.rating.average, 0) / rated.length : null;
  const watched = watchedSet(show.id).size;
  const minutes = episodes.reduce((sum, ep) => sum + (ep.runtime || 0), 0);
  const stat = (label, value) => h("div", { class: "stat" }, h("div", { class: "stat-label" }, label), h("div", { class: "stat-value" }, value));
  return [
    stat("Seasons", seasons.length || "–"),
    stat("Episodes", episodes.length || "–"),
    stat("Avg. episode rating", avg ? avg.toFixed(1) : "–"),
    stat("Total watch time", minutes ? `${Math.round(minutes / 60)} h` : "–"),
    stat("You've watched", episodes.length ? `${Math.round((watched / episodes.length) * 100)}%` : "–"),
  ];
}

function nextEpisodeBox(show, next) {
  if (!next) {
    const text = show.status === "Ended" ? "This show has ended — no new episodes will air." : "No upcoming episode has been announced yet.";
    return h("div", { class: "next-ep" }, h("div", {}, h("h3", {}, "Next episode"), h("span", { class: "muted" }, text)));
  }
  const airs = new Date(next.airstamp);
  const days = Math.max(0, Math.ceil((airs - Date.now()) / 86_400_000));
  return h(
    "div",
    { class: "next-ep" },
    h("div", { class: "countdown" }, h("b", {}, String(days)), h("small", {}, days === 1 ? "day" : "days")),
    h(
      "div",
      {},
      h("h3", {}, `Next: ${episodeCode(next)} · ${next.name}`),
      h("span", { class: "muted" }, `Airs ${airs.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`)
    )
  );
}

function episodesTab(show, episodes, seasons, onChange) {
  if (episodes.length === 0) return stateBox("No episodes listed", "TVmaze has no episode list for this show yet.");
  const watched = watchedSet(show.id);
  const wrap = h("div");

  function draw() {
    const list = episodes.filter((ep) => ep.season === showUi.season);
    const allWatched = list.every((ep) => watched.has(ep.id));
    const seasonBtn = h(
      "button",
      {
        class: "btn ghost",
        type: "button",
        onclick: () => {
          for (const ep of list) allWatched ? watched.delete(ep.id) : watched.add(ep.id);
          setWatched(show.id, watched);
          draw();
          onChange();
        },
      },
      allWatched ? "Unmark season" : "Mark season as watched"
    );

    wrap.replaceChildren(
      h(
        "div",
        { class: "season-bar" },
        seasons.map((season) =>
          h(
            "button",
            {
              class: "chip",
              type: "button",
              "aria-pressed": String(season === showUi.season),
              onclick: () => {
                showUi.season = season;
                draw();
              },
            },
            `Season ${season}`
          )
        ),
        h("span", { class: "spacer" }),
        seasonBtn
      ),
      h(
        "ul",
        { class: "episodes" },
        list.map((ep) => {
          const rating = ep.rating?.average;
          const box = h("input", {
            type: "checkbox",
            checked: watched.has(ep.id),
            "aria-label": `Mark ${episodeCode(ep)} as watched`,
            onchange: () => {
              box.checked ? watched.add(ep.id) : watched.delete(ep.id);
              row.classList.toggle("watched", box.checked);
              setWatched(show.id, watched);
              seasonBtn.textContent = list.every((e) => watched.has(e.id)) ? "Unmark season" : "Mark season as watched";
              onChange();
            },
          });
          const row = h(
            "li",
            { class: `episode ${watched.has(ep.id) ? "watched" : ""}` },
            box,
            h("span", { class: "ep-code" }, episodeCode(ep)),
            h(
              "div",
              {},
              h("div", { class: "ep-name" }, ep.name),
              h("div", { class: "ep-desc" }, [ep.airdate, plainText(ep.summary)].filter(Boolean).join(" · "))
            ),
            h("span", { class: `ep-rating ${rating ? "" : "none"}`, style: rating ? `background:${ratingColor(rating)}` : null }, rating ? rating.toFixed(1) : "–")
          );
          return row;
        })
      )
    );
  }

  draw();
  return wrap;
}

function ratingsTab(episodes, seasons) {
  const rated = episodes.filter((ep) => ep.rating?.average);
  if (rated.length === 0) return stateBox("No ratings yet", "TVmaze users haven't rated these episodes yet.");

  const best = rated.reduce((a, b) => (b.rating.average > a.rating.average ? b : a));
  const worst = rated.reduce((a, b) => (b.rating.average < a.rating.average ? b : a));
  const seasonAvg = seasons
    .map((season) => {
      const list = rated.filter((ep) => ep.season === season);
      return { season, avg: list.length ? list.reduce((s, ep) => s + ep.rating.average, 0) / list.length : 0 };
    })
    .sort((a, b) => b.avg - a.avg)[0];

  return h(
    "div",
    {},
    h("p", { class: "muted", style: "margin-top:0" }, "Every square is one episode, coloured from this show's weakest to its best TVmaze rating. Hover a square to see the episode."),
    h(
      "div",
      { class: "heatmap" },
      seasons.map((season) =>
        h(
          "div",
          { class: "heat-row" },
          h("span", { class: "heat-label" }, `S${season}`),
          episodes
            .filter((ep) => ep.season === season)
            .map((ep) => {
              const r = ep.rating?.average;
              return h(
                "span",
                {
                  class: `heat-cell ${r ? "" : "none"}`,
                  style: r ? `background:${ratingColor(r)}` : null,
                  title: `${episodeCode(ep)} · ${ep.name}${r ? ` · ★ ${r}` : " · not rated"}`,
                },
                r ? r.toFixed(1) : "·"
              );
            })
        )
      )
    ),
    h(
      "div",
      { class: "legend" },
      `★ ${scale.min.toFixed(1)}`,
      h("span", {
        class: "bar",
        style: `background:linear-gradient(90deg, ${ratingColor(scale.min)}, ${ratingColor((scale.min + scale.max) / 2)}, ${ratingColor(scale.max)})`,
      }),
      `★ ${scale.max.toFixed(1)}`
    ),
    h(
      "div",
      { class: "highlights" },
      h("div", { class: "highlight" }, h("small", {}, "Best episode"), h("div", {}, `${episodeCode(best)} · ${best.name} · ★ ${best.rating.average}`)),
      h("div", { class: "highlight" }, h("small", {}, "Weakest episode"), h("div", {}, `${episodeCode(worst)} · ${worst.name} · ★ ${worst.rating.average}`)),
      seasons.length > 1
        ? h("div", { class: "highlight" }, h("small", {}, "Best season"), h("div", {}, `Season ${seasonAvg.season} · ★ ${seasonAvg.avg.toFixed(2)} average`))
        : null
    )
  );
}

function castTab(cast) {
  if (cast.length === 0) return stateBox("No cast listed", "TVmaze has no cast information for this show.");
  return h(
    "div",
    { class: "cast" },
    cast.map(({ person, character }) =>
      h(
        "div",
        { class: "person" },
        h("div", { class: "face" }, person.image ? h("img", { src: person.image.medium, alt: "", loading: "lazy" }) : person.name[0]),
        h("b", {}, person.name),
        h("span", {}, `as ${character.name}`)
      )
    )
  );
}

// ---------- Router (the part after # in the address decides which view is shown) ----------

function route() {
  const [view, param, sub] = location.hash.slice(1).split("/");
  document.title = "Showboard";
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === (view === "watchlist" ? "watchlist" : view ? "" : "home"));
  });

  if (view === "search" && param) searchView(decodeURIComponent(param));
  else if (view === "show" && /^\d+$/.test(param)) showView(Number(param), sub);
  else if (view === "watchlist") watchlistView();
  else homeView();
}

// ---------- Theme toggle (remembered in this browser) ----------

function setupTheme() {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem("showboard.theme");
    if (saved) root.dataset.theme = saved;
  } catch {}
  document.getElementById("theme").addEventListener("click", () => {
    const isLight = root.dataset.theme ? root.dataset.theme === "light" : matchMedia("(prefers-color-scheme: light)").matches;
    root.dataset.theme = isLight ? "dark" : "light";
    try {
      localStorage.setItem("showboard.theme", root.dataset.theme);
    } catch {}
  });
}

// Other open tabs changed the watchlist: reload it so all tabs agree.
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    store = loadStore();
    updateWatchCount();
  }
});

window.addEventListener("hashchange", route);
setupTheme();
updateWatchCount();
route();
