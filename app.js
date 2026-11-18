/* global RecordModel, RecordStorage, RecordCatalog, RecordMaintenance */
(async function () {
  "use strict";
  const M = RecordModel;
  const S = RecordStorage;
  const C = RecordCatalog;
  const maintenance = RecordMaintenance;
  const $ = id => document.getElementById(id);
  $("appVersion").textContent = `V${maintenance.version}`;
  let state, db, revision = 0, pending = 0, failure = null, busy = false, opponentEdited = false;
  let resetComplete = false;
  let historyPage = 0;
  const inputOpponentFilter = document.createElement("select");
  const historyOpponentFilter = document.createElement("select");
  const filterSources = new WeakMap();
  let slotCatalog, slotCard;
  const cardSlotIds = ["cardSlot1", "cardSlot2", "cardSlot3"];
  const resultObservers = [];
  const appScope = new URL("./", document.baseURI).href;
  let offlineSetup = Promise.resolve(), offlineSetupError = null;
  let masterPreview = null;
  let masterFiles = [];
  const masterTitles = {
    STORE_Master: "01_店舗", TEAM_Master: "02_自分用チーム", CARD_Master: "03_カード",
    OPPONENT_Master: "04_対戦履歴", ROUND_Master: "05_ラウンド設定", CAR_Master: "06_車種",
    RANK_Master: "07_ランク", AREA_Master: "08_エリア", CORD_Master: "09_コード"
  };
  const dailyMasters = ["STORE_Master", "TEAM_Master", "CARD_Master", "OPPONENT_Master"];
  let opponentManufacturer = "";
  let queue = Promise.resolve();
  const primary = new Set(["opponent", "nameNote", "opponentRank", "opponentStars", "copiedRate",
    "battleArea", "battleShop", "team", "teamShop", "course", "night", "choice", "random",
    "car", "opponentCar", "win", "behavior", "note"]);
  const roundFields = ["date", "season", "round"];
  const sessionFields = [...roundFields, "card", "myRank", "myStars"];
  const fieldTitles = { myRank: "自ランク", myStars: "星数", battleArea: "対戦店舗\nエリア", teamShop: "チーム\n所属店舗",
    battleShop: "対戦店舗", homeArea: "所属店舗\nエリア", car: "自車種", opponentCar: "相手車種",
    opponentRank: "相手ランク", opponentStars: "★・PRIDE", copiedRate: "勝率", choice: "選択権", win: "勝ち" };
  const checkboxes = ["night", "random", "choice"];
  const lists = { card: "cards", season: "seasons", course: "courses", car: "cars", opponentCar: "cars", team: "teams", teamShop: "teamShops", round: "rounds" };
  const dropdowns = ["season", "round", "card", "myRank", "opponentRank", "myStars", "battleShop", "homeShop", "teamShop", "course", "car", "opponentCar", "behavior"];
  const settingLabels = { seasons: "シーズン", rounds: "ラウンド", cards: "カード", courses: "コース", cars: "車種", teams: "チーム", teamShops: "チーム所属店舗" };
  function report(error) {
    console.error(error);
    $("error").textContent = error.message || String(error);
    $("error").hidden = false;
  }
  function persistenceStatus() {
    $("status").textContent = failure ? "保存失敗：救出用JSONを保存してください"
      : pending ? "端末内に保存中…（完了前に閉じないでください）" : "端末内保存済み・サーバー未同期";
  }
  function persist(snapshot = structuredClone(state)) {
    if (resetComplete) return Promise.reject(new Error("初期化済みです。アプリを開き直してください。"));
    snapshot = M.withoutCardNumbers(snapshot);
    pending++;
    persistenceStatus();
    const operation = queue.then(async () => {
      if (failure) throw failure;
      revision = await S.write(db, snapshot, revision);
    });
    queue = operation.catch(error => { failure = error; report(error); }).finally(() => {
      pending--;
      persistenceStatus();
    });
    return operation;
  }
  function autosave() {
    $("saveEntry").textContent = "この対戦を保存";
    void persist().catch(() => { /* persist reports the failure and keeps the in-memory draft. */ });
  }
  async function flush() {
    await queue;
    if (failure) throw failure;
  }
  function showTab(id) {
    for (const tab of ["entry", "records", "settings"]) $(tab).hidden = tab !== id;
    for (const button of document.querySelectorAll("[data-tab]")) button.setAttribute("aria-pressed", String(button.dataset.tab === id));
    if (id === "settings" && state) renderOpponentTeams();
  }
  function buildFields() {
    const orderedFields = [
      ...sessionFields.map(key => M.fields.find(([field]) => field === key)),
      ...[...primary].map(key => M.fields.find(([field]) => field === key)),
      ...M.fields.filter(([key]) => !sessionFields.includes(key) && !primary.has(key))
    ];
    for (const [key, originalTitle] of orderedFields) {
      if (key === "normalizedName" || key === "copiedRate") continue;
      const title = fieldTitles[key] || originalTitle;
      const label = document.createElement("label");
      label.textContent = title;
      if (key === "battleArea" || key === "homeArea" || key === "teamShop") label.classList.add("two-line-caption");
      const checkbox = checkboxes.includes(key);
      const select = dropdowns.includes(key) || ["myRank", "opponentRank", "battleArea", "homeArea"].includes(key);
      const input = document.createElement(key === "win" ? "button" : select ? "select" : "input");
      input.id = `field-${key}`;
      if (key === "win") {
        input.type = "button";
        input.textContent = "勝ち";
        input.className = "win-toggle";
        input.setAttribute("aria-pressed", "false");
        input.addEventListener("click", () => {
          const pressed = input.getAttribute("aria-pressed") !== "true";
          input.setAttribute("aria-pressed", String(pressed));
          state.draft.values.win = pressed ? "1" : "0";
          autosave();
          renderHistory();
        });
      } else if (select) {
        const options = ["battleArea", "homeArea"].includes(key)
          ? ["", ...M.prefectures].map(value => [value, value || "未入力"])
          : ["myRank", "opponentRank"].includes(key)
          ? ["", "不明", "緑◆", "青◆", "赤◆", "エメラルド", "サファイア", "ルビー", "PRIDE"].map(value => [value, value || "未入力"])
          : key === "win" ? [["", "未入力"], ["1", "勝ち"], ["0", "負け"]]
          : [["", "未入力"], ["1", "あり"], ["0", "なし"]];
        for (const [value, text] of options) input.add(new Option(text, value));
      } else {
        input.type = checkbox ? "checkbox" : "text";
        if (checkbox) label.className = "checkbox-field";
        if (key === "date") {
          input.placeholder = "YYYY-MM-DD";
          input.pattern = "\\d{4}-\\d{2}-\\d{2}";
          input.title = "YYYY-MM-DD形式で入力してください";
          input.addEventListener("input", () => {
            const value = input.value;
            const date = new Date(`${value}T00:00:00Z`);
            input.setCustomValidity(!value || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
              !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value)
              ? "" : "実在する日付をYYYY-MM-DD形式で入力してください。");
          });
        }
        if (lists[key] && key !== "team") input.setAttribute("list", `list-${lists[key]}`);
      }
      input.addEventListener("input", () => {
        const previousRank = state.draft.values.myRank;
        if (key === "opponent") {
          state.playerSearch = input.value;
          opponentEdited = true;
        }
        if (dropdowns.includes(key)) {
          const manual = $(`manual-${key}`);
          manual.hidden = input.selectedOptions[0]?.dataset.manual !== "true";
          if (!manual.hidden) { manual.focus(); return; }
        }
        state.draft.values[key] = checkbox ? (input.checked ? "1" : "0")
          : key === "opponentStars" ? C.normalizeStars(input.value) : input.value;
        if (key === "opponent") state.draft.values.normalizedName = M.normalizeName(input.value);
        if (key === "battleArea" || key === "homeArea") {
          const shopField = key === "battleArea" ? "battleShop" : "homeShop";
          state.draft.values[shopField] = "";
          $(`field-${shopField}`).value = "";
          renderShopPicker(shopField);
        }
        updateContext(key, previousRank);
        autosave();
        renderHistory();
        if (key === "opponent" || key === "team") renderSuggestions(key);
      });
      label.append(input);
      if (key === "opponentCar") {
        const row = document.createElement("span");
        row.className = "opponent-car-controls";
        const manufacturer = document.createElement("select");
        manufacturer.id = "opponentManufacturer";
        manufacturer.setAttribute("aria-label", "相手車種のメーカー");
        input.setAttribute("aria-label", "相手車種");
        manufacturer.addEventListener("input", () => {
          opponentManufacturer = manufacturer.value;
          state.draft.values.opponentCar = "";
          renderDropdown("opponentCar");
          autosave();
          renderHistory();
        });
        input.replaceWith(row);
        row.append(manufacturer, input);
      }
      const historicalNote = key === "nameNote" || key === "note";
      if (key === "opponentRank" || historicalNote) {
        const result = document.createElement("p");
        result.id = historicalNote ? `historical-${key}` : "opponentResult";
        result.className = historicalNote ? "hint historical-note" : "hint";
        result.hidden = historicalNote;
        result.setAttribute("role", "status");
        input.setAttribute("aria-describedby", result.id);
        label.append(result);
      }
      if (key === "date") {
        const container = document.createElement("span");
        container.className = "date-control";
        const calendar = document.createElement("input");
        calendar.id = "dateCalendar";
        calendar.type = "date";
        calendar.setAttribute("aria-label", "日付をカレンダーから選択");
        calendar.title = "カレンダーから選択";
        calendar.addEventListener("click", () => {
          calendar.value = input.validity.valid ? input.value : "";
          if (typeof calendar.showPicker === "function") {
            try { calendar.showPicker(); } catch (error) { report(error); }
          }
        });
        calendar.addEventListener("change", () => {
          input.value = calendar.value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        input.addEventListener("input", () => { calendar.value = input.validity.valid ? input.value : ""; });
        input.replaceWith(container);
        container.append(input, calendar);
      }
      if (dropdowns.includes(key)) {
        const manual = document.createElement("input");
        manual.id = `manual-${key}`;
        manual.type = "text";
        manual.hidden = true;
        manual.placeholder = "リストにない値を直接入力";
        manual.setAttribute("aria-label", title + "を直接入力");
        manual.addEventListener("input", () => {
          const previousRank = state.draft.values.myRank;
          state.draft.values[key] = key === "myStars" ? C.normalizeStars(manual.value) : manual.value;
          updateContext(key, previousRank);
          autosave();
          renderHistory();
          if (key === "team") renderSuggestions(key);
        });
        manual.addEventListener("change", () => {
          renderDropdown(key);
          updateContext(key);
          autosave();
        });
        label.append(manual);
      }
      if (key === "course") {
        const result = document.createElement("p");
        result.id = "courseResult";
        result.className = "hint";
        result.setAttribute("role", "status");
        input.setAttribute("aria-describedby", "courseResult");
        label.append(result);
      }
      if (key === "opponentStars") {
        const combo = document.createElement("span");
        combo.className = "star-combo";
        const choices = document.createElement("span");
        choices.id = "opponentStarOptions";
        choices.className = "star-options";
        choices.hidden = true;
        choices.setAttribute("role", "listbox");
        choices.setAttribute("aria-label", "相手の星の候補");
        input.setAttribute("role", "combobox");
        input.setAttribute("aria-autocomplete", "none");
        input.setAttribute("aria-controls", choices.id);
        input.setAttribute("aria-expanded", "false");
        input.autocomplete = "off";
        let active = -1;
        const showChoices = show => {
          choices.hidden = !show;
          input.setAttribute("aria-expanded", String(show));
          active = -1;
          input.removeAttribute("aria-activedescendant");
          for (const option of choices.children) option.setAttribute("aria-selected", "false");
        };
        const choose = index => {
          input.value = C.formatStars("★".repeat(index + 1));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          showChoices(false);
        };
        for (let count = 1; count <= 8; count++) {
          const option = document.createElement("span");
          option.id = `opponentStarOption-${count}`;
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", "false");
          option.textContent = `${C.formatStars("★".repeat(count))}（${count}個）`;
          option.addEventListener("pointerdown", event => event.preventDefault());
          option.addEventListener("click", event => {
            event.preventDefault();
            choose(count - 1);
          });
          choices.append(option);
        }
        input.addEventListener("focus", () => showChoices(true));
        input.addEventListener("click", () => showChoices(true));
        input.addEventListener("input", () => showChoices(false));
        input.addEventListener("blur", () => {
          input.value = C.formatStars(input.value);
          showChoices(false);
        });
        input.addEventListener("keydown", event => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            if (choices.hidden) showChoices(true);
            active = (active + (event.key === "ArrowDown" ? 1 : active < 0 ? 0 : -1) + 8) % 8;
            Array.from(choices.children).forEach((option, index) => option.setAttribute("aria-selected", String(index === active)));
            input.setAttribute("aria-activedescendant", choices.children[active].id);
            choices.children[active].scrollIntoView({ block: "nearest" });
          } else if (event.key === "Enter" && !choices.hidden) {
            event.preventDefault();
            if (active >= 0) choose(active);
            else showChoices(false);
          } else if (event.key === "Escape") showChoices(false);
        });
        input.placeholder = "★を選択、またはPRIDEの数値を直接入力";
        input.replaceWith(combo);
        combo.append(input, choices);
      }
      const fieldContainer = document.createElement("div");
      fieldContainer.dataset.field = key;
      if (key === "note") fieldContainer.className = "full-width";
      if (key === "opponent") {
        const row = document.createElement("div");
        row.className = "player-search-row";
        const button = document.createElement("button");
        button.type = "button";
        button.id = "pasteClipboard";
        button.textContent = "対戦相手";
        button.title = "手入力で検索中の文字を反映。それ以外はクリップボードから貼付して反映";
        input.setAttribute("aria-label", "対戦相手");
        input.placeholder = "1文字以上で検索";
        row.append(button, input);
        fieldContainer.append(row);
        input.addEventListener("keydown", event => {
          if (event.key === "Enter") event.preventDefault();
        });
        input.addEventListener("paste", event => {
          if (!event.clipboardData) return;
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          void run(() => applyPastedText(text));
        });
      } else if (key === "win") fieldContainer.append(input);
      else fieldContainer.append(label);
      $(roundFields.includes(key) ? "roundFields" : sessionFields.includes(key) ? "cardFields"
        : primary.has(key) ? "primaryFields" : "extraFields").append(fieldContainer);
      if (key === "nameNote") $("primaryFields").append($("affiliationFields"));
      if (key === "opponent" || key === "team") {
        const container = document.createElement("div");
        container.id = `${key}Suggestions`;
        container.className = "suggestions";
        container.setAttribute("role", "group");
        container.setAttribute("aria-label", title + "の検索候補");
        container.hidden = true;
        fieldContainer.append(container);
        input.autocomplete = "off";
        if (key === "team") {
          input.placeholder = "1文字以上でチーム名を検索";
          input.addEventListener("keydown", event => {
            if (event.key === "Enter" && !event.isComposing) event.preventDefault();
          });
        }
        input.addEventListener("focus", () => renderSuggestions(key));
        input.addEventListener("keydown", event => {
          if (event.key === "Escape") container.hidden = true;
          if (event.isComposing || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
          if (container.hidden) renderSuggestions(key);
          const buttons = container.querySelectorAll("button");
          if (!buttons.length) return;
          event.preventDefault();
          buttons[event.key === "ArrowDown" ? 0 : buttons.length - 1].focus();
        });
        container.addEventListener("keydown", event => {
          if (event.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            input.focus();
            container.hidden = true;
          } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            const buttons = Array.from(container.querySelectorAll("button"));
            const index = buttons.indexOf(document.activeElement);
            if (index < 0) return;
            event.preventDefault();
            buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
          }
        });
      }
    }
    const teamField = document.createElement("div");
    teamField.className = "full-width";
    const teamLabel = document.createElement("label");
    teamLabel.textContent = "自チーム";
    const team = document.createElement("select");
    team.id = "cardTeam";
    team.setAttribute("aria-describedby", "cardTeamDetails");
    const teamDetails = document.createElement("p");
    teamDetails.id = "cardTeamDetails";
    teamDetails.className = "hint";
    teamDetails.setAttribute("role", "status");
    teamLabel.append(team, teamDetails);
    teamField.append(teamLabel);
    $("cardFields").append(teamField);
    const field = key => $("primaryFields").querySelector(`[data-field="${key}"]`);
    const courseBlock = document.createElement("div");
    courseBlock.className = "course-block full-width";
    courseBlock.id = "courseBlock";
    field("course").before(courseBlock);
    const conditions = document.createElement("div");
    conditions.className = "checkbox-row course-conditions";
    conditions.append(field("night"), field("random"));
    field("win").className = "full-width win-field";
    field("choice").id = "courseChoice";
    courseBlock.append(field("course"), conditions);
    for (const key of Object.keys(settingLabels)) {
      const datalist = document.createElement("datalist");
      datalist.id = `list-${key}`;
      document.body.append(datalist);
    }
  }
  function renderSuggestions(key) {
    const container = $(`${key}Suggestions`);
    const isPlayer = key === "opponent";
    const query = isPlayer ? $("field-opponent").value : state.draft.values[key];
    const candidates = isPlayer
      ? M.playerSuggestions(state.records, query, state.settings.shopAliases, state.draft.id)
      : C.teamSuggestions(state.records, query, state.draft.id);
    container.replaceChildren();
    container.hidden = !query.trim();
    if (container.hidden) return;
    if (!candidates.length) {
      container.textContent = "該当する過去候補はありません。そのまま入力できます。";
      return;
    }
    for (const candidate of candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = isPlayer
        ? `${candidate.opponent} / ${candidate.homeArea || "所属エリア不明"} / ${candidate.homeShop || "所属店不明"}`
        : `${candidate.team} / ${candidate.teamShop || "所属店舗未入力"}`;
      button.onclick = () => {
        if (isPlayer) {
          state.draft = M.captureOpponentTime(state.draft,
            M.applyPlayerCandidate(state.draft.values, candidate), state.settings.shopAliases);
          state.playerSearch = "";
        } else {
          state.draft.values.team = candidate.team;
          state.draft.values.teamShop = candidate.teamShop;
        }
        autosave();
        renderDraft();
        $(`field-${key}`).focus();
        container.hidden = true;
      };
      container.append(button);
    }
  }
  function renderShopPicker(key) {
    renderDropdown(key);
  }
  function renderDropdown(key) {
    const value = state.draft.values[key];
    if (key === "opponentCar") {
      const groups = C.vehicleGroups(state.settings);
      if (value && !groups.some(group => group.values.includes(value))) {
        let unclassified = groups.find(group => group.manufacturer === null);
        if (!unclassified) groups.push(unclassified = { manufacturer: null, values: [] });
        unclassified.values.push(value);
      }
      const groupKey = group => group.manufacturer === null ? "unclassified" : `manufacturer:${group.manufacturer}`;
      const selectedGroup = value && groups.find(group => group.values.includes(value));
      if (selectedGroup) opponentManufacturer = groupKey(selectedGroup);
      else if (!groups.some(group => groupKey(group) === opponentManufacturer)) {
        opponentManufacturer = groups.length === 1 && groups[0].manufacturer === null ? "unclassified" : "";
      }
      const manufacturer = $("opponentManufacturer");
      manufacturer.replaceChildren(new Option("メーカー選択", ""), ...groups.map(group =>
        new Option(group.manufacturer || "メーカー未分類", groupKey(group))));
      manufacturer.value = opponentManufacturer;
      const group = groups.find(item => groupKey(item) === opponentManufacturer);
      const manualOption = new Option("直接入力…", "");
      manualOption.dataset.manual = "true";
      const select = $("field-opponentCar");
      select.replaceChildren(new Option("未入力", ""), ...(group?.values || []).map(item => new Option(item, item)), manualOption);
      select.value = value;
      $("manual-opponentCar").value = value;
      $("manual-opponentCar").hidden = true;
      return;
    }
    const pairs = C.opponentTeams(state.records, state.draft.id);
    const choices = key === "team" ? [...pairs.map(pair => pair.team), ...state.settings.teams]
      : key === "teamShop" ? pairs.filter(pair => pair.team === state.draft.values.team).map(pair => pair.teamShop)
      : C.choices(state.settings, key, state.draft.values) ?? (["battleShop", "homeShop"].includes(key)
      ? state.settings.shopsByArea?.[state.draft.values[key === "battleShop" ? "battleArea" : "homeArea"]] || []
      : ["myRank", "opponentRank"].includes(key) ? ["不明", "緑◆", "青◆", "赤◆", "エメラルド", "サファイア", "ルビー", "PRIDE"]
      : key === "myStars" ? Array.from({ length: 8 }, (_, index) => "★".repeat(index + 1))
      : key === "behavior" ? state.records.map(record => record.values.behavior)
      : state.settings[lists[key]] || []);
    const select = $(`field-${key}`);
    const manualOption = new Option("直接入力…", "");
    manualOption.dataset.manual = "true";
    const restrictedCourse = key === "course" && !!state.settings.catalog;
    const values = [...new Set([...choices, ...(restrictedCourse ? [] : [value])])].filter(Boolean);
    const options = key === "car" && !state.settings.catalog
      ? C.vehicleOptions(state.settings, values).map(vehicleOption)
      : values.map(item => new Option(C.label(state.settings, key, item), item));
    if (restrictedCourse && value && !choices.includes(value)) {
      const previous = new Option(`候補外の前回値：${value}（選び直してください）`, value);
      previous.disabled = true;
      options.unshift(previous);
    }
    select.replaceChildren(new Option("未入力", ""), ...options, ...(restrictedCourse ? [] : [manualOption]));
    select.value = value;
    $(`manual-${key}`).value = value;
    $(`manual-${key}`).hidden = true;
  }
  function updateContext(key, previousRank) {
    if (key === "team") {
      const pair = C.opponentTeams(state.records, state.draft.id).find(pair => pair.team === state.draft.values.team);
      state.draft.values.teamShop = pair?.teamShop || "";
      renderDropdown("teamShop");
    }
    if (key === "card" && state.settings.catalog) {
      state.draft.values = C.applyCard(state.settings, state.draft.values);
      for (const field of ["myRank", "myStars", "car"]) renderDropdown(field);
    }
    if ((key === "card" || key === "myRank") && previousRank !== undefined) {
      state.draft.values = M.syncDefaultOpponentRank(state.draft.values, previousRank);
      renderDropdown("opponentRank");
    }
    if (key === "date") {
      applyDefaultRound(state);
      for (const field of ["season", "round", "course"]) renderDropdown(field);
    }
    if (key === "season") renderDropdown("round");
    if (key === "season" || key === "round") renderDropdown("course");
    renderCatalogWarnings();
  }
  function renderCatalogWarnings() {
    $("catalogWarnings").textContent = C.warnings(state.settings, state.draft.values).join("\n");
    const card = C.selectedCard(state.settings, state.draft.values);
    $("saveCardRank").hidden = !card;
    renderCardTeam(card);
    renderCardSlots(card);
  }
  function renderCardTeam(card) {
    const select = $("cardTeam");
    const teams = state.settings.catalog?.personal.teams || [];
    select.replaceChildren(new Option(card ? "未所属・未登録" : "カードを選択", ""),
      ...teams.map(team => new Option(team.label, team.id)));
    if (card && card.teamId === null && card.teamLabel) {
      let value = "__unlinked__";
      while (teams.some(team => team.id === value)) value += "_";
      const option = new Option(`未紐付け：${card.teamLabel}`, value);
      option.disabled = true;
      select.add(option);
      select.value = value;
    } else select.value = card?.teamId || "";
    select.disabled = !card;
    const selectedTeam = teams.find(team => team.id === card?.teamId);
    $("cardTeamDetails").textContent = card
      ? `チーム番号：${selectedTeam?.number || "未登録"} / 所属店舗：${selectedTeam?.homeStoreLabel || "未登録"}` : "";
    fitResult("cardTeamDetails");
  }
  function renderCardSlots(card) {
    const catalog = state.settings.catalog;
    $("cardSlotEditor").hidden = !card;
    if (slotCatalog === catalog && slotCard === card) return;
    slotCatalog = catalog;
    slotCard = card;
    $("cardSlotStatus").textContent = "";
    $("saveCardSlots").disabled = true;
    if (!card) return;
    const byId = new Map(catalog.common.vehicles.map(vehicle => [vehicle.id, vehicle]));
    const garageIds = [...new Set(card.garage.map(slot => slot.vehicleId))];
    const garageSet = new Set(garageIds);
    const groups = [
      ["車庫", garageIds.map(id => byId.get(id))],
      ["全車種（車庫以外）", catalog.common.vehicles.filter(vehicle => !garageSet.has(vehicle.id))]
    ];
    for (const [index, id] of cardSlotIds.entries()) {
      const select = $(id);
      select.replaceChildren(new Option("未登録", ""));
      for (const [title, vehicles] of groups) {
        if (!vehicles.length) continue;
        const group = document.createElement("optgroup");
        group.label = title;
        for (const vehicle of vehicles) group.append(new Option(vehicle.label, vehicle.id));
        select.append(group);
      }
      select.value = card.activeSlots.find(slot => slot.slot === index + 1)?.vehicleId || "";
    }
  }
  function settingsTable(rows, headings) {
    const table = document.createElement("table");
    table.className = `settings-table${headings ? "" : " card-info"}`;
    if (headings) {
      const header = table.createTHead().insertRow();
      for (const title of headings) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = title;
        header.append(cell);
      }
    }
    const body = table.createTBody();
    for (const values of rows) {
      const row = body.insertRow();
      values.forEach((value, index) => {
        const cell = document.createElement(!headings && index === 0 ? "th" : "td");
        if (!headings && index === 0) cell.scope = "row";
        if (value instanceof Node) cell.append(value);
        else cell.textContent = value;
        row.append(cell);
      });
    }
    return table;
  }
  function vehicleOption(item) {
    const option = new Option(item.label, item.value);
    option.disabled = item.divider;
    return option;
  }
  function renderRoundChoices() {
    const rounds = state.settings.catalog?.common.rounds.filter(round => round.seasonId === $("roundSeason").value) || [];
    const selected = $("roundSelector").value;
    $("roundSelector").replaceChildren(new Option("選択してください", ""),
      ...rounds.map(round => new Option(round.roundLabel, round.id)));
    $("roundSelector").value = rounds.some(round => round.id === selected) ? selected
      : rounds.find(round => round.roundLabel === state.draft.values.round)?.id || "";
    renderRoundCourses();
  }
  function renderRoundCourses() {
    const common = state.settings.catalog?.common;
    const round = common?.rounds.find(item => item.id === $("roundSelector").value);
    $("roundCourses").replaceChildren();
    if (!round) {
      $("roundCourses").textContent = "シーズン・ラウンドを選択してください。";
      return;
    }
    $("roundCourses").append(settingsTable([
      ["開催期間", `${round.startDate} ～ ${round.endDate}`],
      ["対象コース", round.courseIds.map(id => common.courses.find(course => course.id === id).label).join("\n")]
    ]));
  }
  function renderOpponentTeams() {
    const query = $("opponentTeamSearch").value.normalize("NFKC").toLowerCase();
    const pairs = C.opponentTeams(state.records).filter(pair =>
      `${pair.team} ${pair.teamShop}`.normalize("NFKC").toLowerCase().includes(query));
    $("opponentTeamList").replaceChildren(pairs.length
      ? settingsTable(pairs.map(pair => [pair.team, pair.teamShop || "未登録"]), ["相手チーム", "チーム所属店舗"])
      : document.createTextNode("該当する相手チームの記録はありません。"));
  }
  function applyDefaultRound(snapshot) {
    if (!snapshot.records.some(record => record.id === snapshot.draft.id)) {
      const values = snapshot.draft.values;
      const round = C.selectedRound(snapshot.settings, values);
      const outsidePeriod = round && (values.date < round.startDate || values.date > round.endDate);
      const suggested = C.suggestContext(snapshot.settings, outsidePeriod ? { ...values, season: "", round: "" } : values);
      if (suggested.season || suggested.round) snapshot.draft.values = suggested;
    }
  }
  function newSessionDraft(previous) {
    const draft = M.newDraft();
    if (state.settings.catalog) {
      draft.values = C.suggestContext(state.settings, draft.values);
      if (C.choices(state.settings, "card", previous).includes(previous.card)) {
        draft.values.card = previous.card;
        draft.values = C.applyCard(state.settings, draft.values);
        draft.values.opponentRank = draft.values.myRank;
      }
    }
    return draft;
  }
  function renderAreas() {
    for (const key of ["battleArea", "homeArea"]) {
      const input = $(`field-${key}`);
      const value = state.draft.values[key];
      const areas = [...new Set([...(state.settings.catalog?.common.areas.map(area => area.label) || M.prefectures), ...Object.keys(state.settings.shopsByArea || {}),
        ...state.records.flatMap(record => [record.values.battleArea, record.values.homeArea]), value])].filter(Boolean);
      input.replaceChildren(new Option("未入力", ""), ...areas.map(area => new Option(area, area)));
      input.value = value;
    }
  }
  function renderDraft() {
    opponentEdited = false;
    opponentManufacturer = "";
    renderAreas();
    for (const [key] of M.fields) {
      const input = $(`field-${key}`);
      if (input) {
        const value = state.draft.values[key];
        if (input.tagName === "SELECT" && !Array.from(input.options).some(option => option.value === value)) {
          input.add(new Option(value, value));
        }
        if (key === "win") input.setAttribute("aria-pressed", String(value === "1"));
        else if (checkboxes.includes(key)) input.checked = value === "1";
        else input.value = key === "opponentStars" ? C.formatStars(value) : value;
      }
    }
    $("dateCalendar").value = state.draft.values.date;
    $("field-opponent").value = state.playerSearch || state.draft.values.opponent;
    const editing = state.records.some(r => r.id === state.draft.id);
    $("entryTitle").hidden = !editing;
    $("entryTitle").textContent = editing ? "旧版で訂正中だった下書き（保存済み記録は変更できません）" : "";
    for (const key of dropdowns) renderDropdown(key);
    for (const key of ["opponent", "team"]) $(`${key}Suggestions`).hidden = true;
    renderHistory();
    renderCatalogWarnings();
  }
  function appendHighlighted(container, value, ranges) {
    for (const part of M.searchHighlightParts(value, ranges)) {
      if (part.matched) {
        const mark = document.createElement("mark");
        mark.textContent = part.text;
        container.append(mark);
      } else container.append(document.createTextNode(part.text));
    }
  }
  function isAppRecord(record) {
    return !record.id.startsWith("excel-datano:");
  }
  function recordsTable(records, showAffiliation, matches = new Map(), winRates = new Map(), opponentFilter = null) {
    const columns = [
      ["日付", r => [r.opponentConfirmedAt ? M.matchDateTime(r) : r.values.date,
        [r.values.season, r.values.round].filter(Boolean).join(" / "),
        !showAffiliation && r.temporaryNo ? `仮No. ${r.temporaryNo}` : ""].filter(Boolean).join("\n")],
      ...(showAffiliation ? [
        ["登録No.", r => isAppRecord(r) ? r.temporaryNo : r.id.slice("excel-datano:".length)]
      ] : []),
      ["自カード", r => r.values.card],
      ...(showAffiliation ? [
        ["相手", r => r.values.opponent],
        ["エリア・所属店", r => [r.values.homeArea, r.values.homeShop].filter(Boolean).join("\n")],
        ["チーム", r => r.values.teamShop
          ? `${r.values.team || "未入力"}\n所属店：${r.values.teamShop}` : r.values.team]
      ] : []),
      ["コース", r => r.values.course],
      ["勝敗", r => r.values.win === "1" ? "勝ち" : r.values.win === "0" ? "負け" : "未入力"],
      ...(!showAffiliation ? [
        ["CNメモ・追加メモ", r => [
          r.values.nameNote ? `CN：${r.values.nameNote}` : "",
          r.values.note ? `追加：${r.values.note}` : ""
        ].filter(Boolean).join("\n")]
      ] : [])
    ];
    const wrapper = document.createElement("div");
    wrapper.className = "records-table-scroll";
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", showAffiliation ? "保存済みの対戦一覧" : "同じ相手の過去記録一覧");
    const table = document.createElement("table");
    table.className = "records-table";
    const header = table.createTHead().insertRow();
    for (const [label] of columns) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      if (label === "相手" && opponentFilter) th.append(opponentFilter);
      header.append(th);
    }
    const body = table.createTBody();
    for (const record of records) {
      const row = body.insertRow();
      row.classList.toggle("record-win", record.values.win === "1");
      row.classList.toggle("record-provisional", showAffiliation && isAppRecord(record));
      row.title = (showAffiliation
        ? `相手ランク：${record.values.opponentRank || "未入力"}\n★・PRIDE：${C.formatStars(record.values.opponentStars) || "未入力"}` +
          `\n勝率：${winRates.get(record) || "照合不可（名前・所属店舗が必要）"}\n`
        : "") +
        `自車：${record.values.car || "未入力"}\n相手車：${record.values.opponentCar || "未入力"}` +
        (showAffiliation ? `\nCNメモ：${record.values.nameNote || "未入力"}\n追加メモ：${record.values.note || "未入力"}` : "");
      const found = matches.get(record) || {};
      for (const [label, value] of columns) {
        const cell = row.insertCell();
        if (label === "相手" && showAffiliation) {
          appendHighlighted(cell, record.values.opponent || "—", found.opponent);
          for (const [key, caption] of [["nameNote", "CNメモ"], ["note", "追加メモ"]]) {
            if (!found[key]) continue;
            cell.append(document.createTextNode(`\n${caption}：`));
            appendHighlighted(cell, record.values[key], found[key]);
          }
        } else if (label === "エリア・所属店" && (found.homeArea || found.homeShop)) {
          if (record.values.homeArea) {
            appendHighlighted(cell, record.values.homeArea, found.homeArea);
            if (record.values.homeShop) cell.append(document.createTextNode("\n"));
          }
          if (record.values.homeShop) appendHighlighted(cell, record.values.homeShop, found.homeShop);
        } else if (label === "チーム" && found.team) {
          appendHighlighted(cell, record.values.team, found.team);
          if (record.values.teamShop) cell.append(document.createTextNode(`\n所属店：${record.values.teamShop}`));
        } else cell.textContent = value(record) || "—";
      }
    }
    wrapper.append(table);
    return wrapper;
  }
  function fitResult(id) {
    const hint = $(id);
    if (!hint || !hint.clientWidth || !hint.textContent) return;
    hint.style.removeProperty("font-size");
    const range = document.createRange();
    range.selectNodeContents(hint);
    const textWidth = range.getBoundingClientRect().width;
    if (textWidth > hint.clientWidth) {
      const size = parseFloat(getComputedStyle(hint).fontSize);
      hint.style.fontSize = `${Math.floor(size * hint.clientWidth / textWidth * 100) / 100}px`;
    }
  }
  function renderHistory() {
    renderCatalogWarnings();
    $("primaryFields").classList.toggle("current-win", $("field-win").getAttribute("aria-pressed") === "true");
    const records = M.findHistory(state.records, state.draft.values, state.settings.shopAliases, state.draft.id);
    const previous = records[0];
    const at = M.hasCurrentOpponentTime(state.draft, state.settings.shopAliases)
      ? state.draft.opponentConfirmedAt : "";
    $("opponentTimeInfo").hidden = !state.draft.values.opponent.trim();
    $("opponentTimeInfo").textContent = at
      ? at.slice(0, 10) === state.draft.values.date
        ? `相手確定時刻 ${at.slice(11, 19)}（端末時刻）`
        : "対戦日と取得日が異なるため、CSVには日付のみを出力します。"
      : "相手情報の反映時に時刻を取得します。未取得の場合は保存時刻を使います。";
    $("opponentResult").textContent = previous
      ? `勝率${M.formatWinRate(records)} / 前回対戦日${previous.values.date}` : "過去記録なし";
    fitResult("opponentResult");
    for (const key of ["nameNote", "note"]) {
      const note = records.find(record => record.values[key].trim())?.values[key] || "";
      $(`historical-${key}`).textContent = note ? `過去：${note}` : "";
      $(`historical-${key}`).hidden = !note;
    }
    const courseMatch = M.previousCourseMatch(state.records, state.draft.values, state.settings.shopAliases, state.draft.id);
    const result = M.previousOutcome(courseMatch);
    $("field-course").classList.toggle("previous-win", result === "1");
    $("field-course").classList.toggle("previous-loss", result === "0");
    $("courseResult").textContent = M.formatCourseResult(records, courseMatch);
    fitResult("courseResult");
    $("history").replaceChildren();
    const summary = document.createElement("p");
    summary.textContent = `保存済み ${records.length}戦` +
      (records.length ? `・勝率 ${M.formatWinRate(records)}` : "");
    $("history").append(summary, recordsTable(records.slice(0, 10), false));
  }
  function renderInputRecords() {
    if (resetComplete) return;
    const all = state.records.filter(isAppRecord);
    updateOpponentFilter(inputOpponentFilter, all);
    const filter = M.opponentNameFilter(inputOpponentFilter.value);
    const appRecords = all.filter(filter).reverse();
    const winRates = M.opponentWinRates(state.records, state.settings.shopAliases, appRecords);
    const count = appRecords.length.toLocaleString("ja-JP");
    $("inputRecordCount").textContent = appRecords.length === all.length ? `(${count}件)`
      : `(${count} / ${all.length.toLocaleString("ja-JP")}件)`;
    renderFilteredTable("inputRecordList", appRecords, undefined, winRates, inputOpponentFilter);
  }
  function updateOpponentFilter(select, records) {
    if (filterSources.get(select) === state.records) return;
    filterSources.set(select, state.records);
    const previous = select.value;
    const names = [...new Set(records.map(record => record.values.opponent).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ja"));
    const options = document.createDocumentFragment();
    options.append(new Option("すべて", ""));
    for (const name of names) options.append(new Option(name, name));
    select.replaceChildren(options);
    select.value = names.includes(previous) ? previous : "";
  }
  function renderFilteredTable(id, rows, matches, rates, filter) {
    const container = $(id);
    const left = container.firstElementChild?.scrollLeft || 0;
    const focused = document.activeElement === filter;
    const wrapper = recordsTable(rows, true, matches, rates, filter);
    container.replaceChildren(wrapper);
    wrapper.scrollLeft = left;
    if (focused) filter.focus({ preventScroll: true });
  }
  function renderRecords() {
    if (resetComplete) return;
    renderInputRecords();
    $("recordCount").textContent = `(${state.records.length.toLocaleString("ja-JP")}件)`;
    renderSavedRecords();
  }
  function renderSavedRecords() {
    if (resetComplete) return;
    if (!$("savedRecords").open) {
      $("recordList").replaceChildren();
      $("recordSearchInfo").textContent = "";
      $("historyPages").hidden = true;
      return;
    }
    updateOpponentFilter(historyOpponentFilter, state.records);
    const query = $("search").value.trim();
    const opponent = historyOpponentFilter.value;
    const result = M.recordHistoryPage(state.records, query, historyPage, opponent);
    historyPage = result.page;
    const count = value => value.toLocaleString("ja-JP");
    const total = query || opponent ? `検索結果：${count(result.total)}件 / 全${count(state.records.length)}件`
      : `全${count(result.total)}件`;
    $("recordSearchInfo").textContent = result.total
      ? `${total}（${count(result.firstShown)}〜${count(result.lastShown)}件目を表示）` : total;
    $("historyPages").hidden = result.lastPage === 0;
    $("historyPrevious").disabled = historyPage === 0;
    $("historyNext").disabled = historyPage === result.lastPage;
    $("historyPageNumber").textContent = `${count(historyPage + 1)} / ${count(result.lastPage + 1)}ページ`;
    const rates = M.opponentWinRates(state.records, state.settings.shopAliases, result.rows);
    renderFilteredTable("recordList", result.rows, result.matches, rates, historyOpponentFilter);
  }
  function changeHistoryPage(step, button) {
    historyPage += step;
    renderSavedRecords();
    if (button.disabled) $(step > 0 ? "historyPrevious" : "historyNext").focus();
  }
  function renderSettings() {
    for (const key of Object.keys(settingLabels)) {
      $(`list-${key}`).replaceChildren(...(state.settings[key] || []).map(value => new Option(value, value)));
    }
    const selectedSeason = $("roundSeason").value;
    const seasons = state.settings.catalog?.common.seasons || [];
    $("roundSeason").replaceChildren(new Option("選択してください", ""), ...seasons.map(season => new Option(season.label, season.id)));
    $("roundSeason").value = seasons.some(season => season.id === selectedSeason) ? selectedSeason
      : seasons.find(season => season.label === state.draft.values.season)?.id || "";
    renderRoundChoices();
    renderOpponentTeams();
    $("catalogInfo").textContent = state.settings.catalog
      ? `設定済み：${state.settings.catalog.common.vehicles.length}車種・${state.settings.catalog.common.rounds.length}ラウンド・${state.settings.catalog.common.stores.length}店舗・${state.settings.catalog.personal.cards.length}カード`
      : "マスターは未登録です。初回は対戦履歴以外の設定マスターをすべて取り込んでください。";
  }
  async function run(action) {
    if (busy || resetComplete) return;
    busy = true;
    $("entryFields").disabled = true;
    $("masterFields").disabled = true;
    $("excelExportFields").disabled = true;
    $("maintenanceFields").disabled = true;
    try {
      if (!failure) $("error").hidden = true;
      await flush();
      await action();
    } catch (error) { report(error); }
    finally {
      busy = false;
      if (!resetComplete) {
        $("entryFields").disabled = false;
        $("masterFields").disabled = false;
        $("excelExportFields").disabled = false;
        $("maintenanceFields").disabled = false;
      }
    }
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function backupText() {
    return JSON.stringify({ ...M.withoutCardNumbers(state), revision: undefined, exportedAt: new Date().toISOString() }, null, 2);
  }
  function maintenanceCounts() {
    const app = state.records.filter(isAppRecord).length;
    const hasDraft = Boolean(state.paste || state.playerSearch ||
      Object.entries(state.draft.values).some(([key, value]) => !sessionFields.includes(key) && value && value !== "0"));
    return { official: state.records.length - app, app, hasDraft };
  }
  function formatBytes(value) {
    return Number.isFinite(value) ? `${(value / 1024 / 1024).toFixed(2)} MiB` : "取得不可";
  }
  async function usageSnapshot() {
    const counts = maintenanceCounts();
    const stateBytes = new Blob([JSON.stringify(M.withoutCardNumbers(state))]).size;
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const caches = globalThis.caches ? await maintenance.cacheNames() : null;
    return {
      appVersion: maintenance.version,
      ...counts,
      stateJsonBytes: stateBytes,
      originUsageBytes: estimate?.usage ?? null,
      originQuotaBytes: estimate?.quota ?? null,
      persistentStorage: persisted,
      appCacheGenerations: caches?.length ?? null,
      saveState: failure ? "失敗" : pending ? "保存中" : "保存済み",
      secureContext: window.isSecureContext,
      serviceWorkerSupported: "serviceWorker" in navigator,
      online: navigator.onLine
    };
  }
  async function updateUsage() {
    const data = await usageSnapshot();
    if (resetComplete) return;
    $("usageInfo").textContent = [
      `正式な過去記録：${data.official.toLocaleString("ja-JP")}件`,
      `Excel未反映のアプリ入力記録：${data.app.toLocaleString("ja-JP")}件`,
      `対戦情報の下書き：${data.hasDraft ? "あり" : "なし"}（日付・カード等の継続値は除く）`,
      `アプリ内データのJSON換算：${formatBytes(data.stateJsonBytes)}（保存容量・メモリ実測ではありません）`,
      `同じ接続先全体の保存使用量：約${formatBytes(data.originUsageBytes)} / 保存上限の目安：${formatBytes(data.originQuotaBytes)}`,
      `アプリ用キャッシュ：${data.appCacheGenerations === null ? "確認非対応" : `${data.appCacheGenerations}世代`}`,
      `ストレージ保持：${data.persistentStorage === null ? "確認非対応" : data.persistentStorage ? "許可済み" : "未許可"}`,
      `保存状態：${data.saveState}`
    ].join("\n");
    return data;
  }
  function finishReset() {
    resetComplete = true;
    db.close();
    resultObservers.forEach(observer => observer.disconnect());
    state = null;
    masterPreview = null;
    masterFiles = [];
    slotCatalog = slotCard = null;
    filterSources.delete(inputOpponentFilter);
    filterSources.delete(historyOpponentFilter);
    inputOpponentFilter.replaceChildren();
    historyOpponentFilter.replaceChildren();
    const main = document.querySelector("main");
    const heading = document.createElement("h2");
    heading.textContent = "このアプリの端末内データを初期化しました";
    const message = document.createElement("p");
    message.textContent = "このタブを閉じてください。再利用する場合は開き直し、マスターまたはJSONバックアップを読み込んでください。別タブに残る古い内容を救出した場合は、消去済みデータの再取込に注意してください。";
    main.replaceChildren(heading, message, $("status").closest("footer"));
    $("status").textContent = "初期化完了・このタブでの入力と保存は停止しています";
    $("error").hidden = true;
  }
  buildFields();
  for (const label of document.querySelectorAll("label")) {
    if (label.classList.contains("plain-label")) continue;
    const caption = document.createElement("span");
    caption.className = "field-caption";
    const controls = document.createElement("span");
    controls.className = "field-controls";
    for (const node of Array.from(label.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) caption.append(node);
      else controls.append(node);
    }
    label.append(caption, controls);
  }
  const courseLabel = $("field-course").closest("label");
  $("field-course").setAttribute("aria-label", "コース");
  const courseField = document.createElement("div");
  courseField.className = "course-field";
  const courseHeading = document.createElement("div");
  courseHeading.className = "course-heading";
  courseHeading.append(courseLabel.querySelector(".field-caption"), $("courseChoice"));
  courseField.append(courseHeading, courseLabel.querySelector(".field-controls"));
  courseLabel.replaceWith(courseField);
  for (const id of ["courseResult", "opponentResult", "cardTeamDetails"]) {
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      fitResult(id);
    });
    observer.observe($(id));
    resultObservers.push(observer);
  }
  for (const button of document.querySelectorAll("[data-tab]")) button.onclick = () => showTab(button.dataset.tab);
  window.addEventListener("beforeunload", event => {
    if (pending || failure) { event.preventDefault(); event.returnValue = ""; }
  });
  try {
    db = await S.open();
    const stored = await S.read(db);
    if (stored && stored.reset !== true) {
      state = M.validateBackup(stored);
      revision = stored.revision;
      const settings = C.compactGarages(C.cleanOpponentLists(state.settings));
      if (state !== stored || settings !== state.settings) {
        state.settings = settings;
        await persist();
      }
    } else {
      revision = stored?.revision ?? 0;
      state = { schema: 1, records: [], draft: M.newDraft(), settings: structuredClone(M.defaultSettings), paste: "" };
      await persist();
    }
    const previousValues = state.draft.values;
    applyDefaultRound(state);
    if (state.draft.values !== previousValues) await persist();
    renderDraft();
    renderSettings();
    renderRecords();
    $("entryFields").disabled = false;
    $("masterFields").disabled = false;
    $("excelExportFields").disabled = false;
    $("maintenanceFields").disabled = false;
    for (const id of ["checkUsage", "showDiagnostics"]) $(id).disabled = false;
    for (const id of ["csv", "backup", "rescue", "restore", "importHistory", "importHistoryCsv", "persist"]) $(id).disabled = false;
    persistenceStatus();
  } catch (error) {
    report(error);
    $("status").textContent = "初期化失敗：保存できないため入力を開始できません";
    return;
  }
  $("pasteClipboard").onclick = () => {
    if (busy) return;
    const entered = opponentEdited ? $("field-opponent").value : "";
    if (entered.trim()) {
      void run(() => applyPastedText(entered));
      return;
    }
    if (!navigator.clipboard?.readText) {
      report(new Error("このブラウザではクリップボードを読み取れません。対戦相手欄へ直接ペーストしてください。"));
      return;
    }
    let reading;
    try {
      reading = navigator.clipboard.readText().then(text => ({ text }), error => ({ error }));
    }
    catch (error) {
      report(error);
      return;
    }
    void run(async () => {
      const read = await reading;
      if (read.error) throw new Error(`貼付できませんでした。ブラウザの許可を確認するか、対戦相手欄へ直接ペーストしてください。（${read.error.message}）`);
      if (!read.text.trim()) throw new Error("クリップボードと検索欄が空です。Viewerでコピーしてから貼付してください。");
      await applyPastedText(read.text);
    });
  };
  async function applyPastedText(text) {
    $("saveEntry").textContent = "この対戦を保存";
    state.paste = text;
    await persist();
    if (!text.includes("\t") && text.trim() && !/[\r\n]/.test(text.trim())) {
      const name = text.trim();
      const candidates = M.playerSuggestions(state.records, name, state.settings.shopAliases, state.draft.id);
      const next = structuredClone(state);
      next.paste = "";
      next.playerSearch = "";
      if (candidates.length) {
        next.draft.values.opponent = name;
        next.draft.values.normalizedName = M.normalizeName(name);
      }
      if (!candidates.length) {
        next.draft.values = M.applyUnknownPlayer(next.draft.values, name);
        next.draft.status = "pending";
      }
      await persist(next);
      state = next;
      renderDraft();
      if (candidates.length) renderSuggestions("opponent");
      $("pasteInfo").textContent = candidates.length
        ? "名前を読み取りました。検索候補をクリックして反映してください。"
        : "名前を反映しました。過去候補がないため相手関連の欄は空欄にしました。";
      return;
    }
    const applied = M.applyPasteWithHistory(state.draft.values, text,
      state.records, state.settings.shopAliases, state.draft.id);
    const next = structuredClone(state);
    next.draft.values = applied.values;
    next.draft = M.captureOpponentTime(next.draft, applied.values, next.settings.shopAliases);
    next.paste = "";
    next.playerSearch = "";
    await persist(next);
    state = next;
    renderDraft();
    if (!applied.matched) renderSuggestions("opponent");
    $("pasteInfo").textContent = applied.matched
      ? "4列と前回情報を反映・保存しました。"
      : "4列を反映・保存しました。一致する過去記録がありません。所属店舗を確認するか、相手候補を選んでください。";
  }
  $("entryForm").onsubmit = event => {
    event.preventDefault();
    void run(async () => {
      const now = new Date().toISOString();
      const next = structuredClone(state);
      for (const key of checkboxes) next.draft.values[key] = $(`field-${key}`).checked ? "1" : "0";
      next.draft.values.win = $("field-win").getAttribute("aria-pressed") === "true" ? "1" : "0";
      if (next.records.some(r => r.id === next.draft.id)) {
        throw new Error("保存済み記録の訂正はできません。必要ならJSONバックアップを保存し、下書きを破棄して新規入力してください。");
      }
      M.validateRecord(next.draft);
      next.draft = M.captureOpponentTime(next.draft, next.draft.values, next.settings.shopAliases);
      delete next.draft.opponentConfirmedIdentity;
      const allocation = M.nextTemporaryNo(next.records, next.temporaryNoCounters, next.draft.values);
      next.draft.temporaryNo = allocation.temporaryNo;
      next.temporaryNoCounters = allocation.counters;
      const number = next.draft.temporaryNo;
      next.records = M.upsert(next.records, { ...next.draft, createdAt: now, updatedAt: now });
      next.draft = newSessionDraft(state.draft.values);
      next.paste = "";
      next.playerSearch = "";
      await persist(next);
      state = next;
      renderDraft();
      renderRecords();
      $("saveEntry").textContent = `保存完了（仮No. ${number}）`;
    });
  };
  $("newEntry").onclick = () => run(async () => {
    if (!confirm("現在の下書きを破棄しますか？ 保存済みの対戦は消えません。")) return;
    const next = structuredClone(state);
    next.draft = newSessionDraft(state.draft.values);
    next.paste = "";
    next.playerSearch = "";
    await persist(next);
    state = next;
    renderDraft();
    $("saveEntry").textContent = "この対戦を保存";
  });
  $("savedRecords").ontoggle = () => renderSavedRecords();
  $("historyPrevious").onclick = event => changeHistoryPage(-1, event.currentTarget);
  $("historyNext").onclick = event => changeHistoryPage(1, event.currentTarget);
  for (const [filter, title, list] of [
    [inputOpponentFilter, "入力記録の相手で絞り込み", "inputRecordList"],
    [historyOpponentFilter, "過去実績の相手で絞り込み", "recordList"]
  ]) {
    filter.className = "opponent-column-filter";
    filter.setAttribute("aria-label", title);
    filter.setAttribute("aria-controls", list);
  }
  inputOpponentFilter.onchange = renderInputRecords;
  historyOpponentFilter.onchange = () => {
    historyPage = 0;
    renderSavedRecords();
  };
  $("search").oninput = () => {
    historyPage = 0;
    const open = Boolean($("search").value.trim() || historyOpponentFilter.value);
    if ($("savedRecords").open !== open) $("savedRecords").open = open;
    else renderSavedRecords();
  };
  $("cardTeam").onchange = () => {
    const card = C.selectedCard(state.settings, state.draft.values);
    const teamId = $("cardTeam").value || null;
    void run(async () => {
      if (!card) throw new Error("登録カードを選択してください。");
      const next = structuredClone(state);
      next.settings = C.updateCardTeam(state.settings, card.id, teamId);
      await persist(next);
      state = next;
    }).then(() => renderCatalogWarnings());
  };
  for (const id of cardSlotIds) {
    $(id).onchange = () => {
      $("saveCardSlots").disabled = !cardSlotIds.some((key, i) =>
        $(key).value !== (slotCard?.activeSlots.find(slot => slot.slot === i + 1)?.vehicleId || ""));
      $("cardSlotStatus").textContent = $("saveCardSlots").disabled ? "" : "未保存のスロット変更があります。";
    };
  }
  $("saveCardSlots").onclick = () => run(async () => {
    const card = C.selectedCard(state.settings, state.draft.values);
    if (!card || card !== slotCard) throw new Error("登録カードを選択し直してください。");
    const vehicleIds = cardSlotIds.map(id => $(id).value);
    let settings;
    try { settings = C.updateCardSlots(state.settings, card.id, vehicleIds); }
    catch (error) {
      $("cardSlotStatus").textContent = error.message;
      throw error;
    }
    const values = state.draft.values;
    const car = C.choices(settings, "car", values).includes(values.car) ? values.car : "";
    const next = { ...state, settings, draft: { ...state.draft, values: { ...values, car } } };
    await persist(next);
    state = next;
    renderDropdown("car");
    renderCatalogWarnings();
    $("cardSlotStatus").textContent = values.car && !car
      ? "保存しました。現在の入力の自車種を選び直してください。"
      : "スロット変更を端末に保存しました。";
  });
  $("roundSeason").onchange = renderRoundChoices;
  $("roundSelector").onchange = renderRoundCourses;
  $("opponentTeamSearch").oninput = renderOpponentTeams;
  function clearMasterPreview(message = "") {
    masterPreview = null;
    $("masterPreview").hidden = true;
    $("masterDiffs").replaceChildren();
    $("masterInfo").textContent = message;
  }
  function runMaster(action) {
    return run(async () => {
      try { await action(); }
      catch (error) {
        $("masterInfo").textContent = error.message || String(error);
        throw error;
      }
    });
  }
  function showMasterDiffs(diffs) {
    const container = $("masterDiffs");
    container.replaceChildren();
    const titles = { label: "カード名", teamId: "チームID", teamLabel: "チーム名",
      rank: "現在ランク", stars: "★・PRIDE",
      activeSlots: "登録車両", garage: "車庫" };
    const display = value => Array.isArray(value)
      ? value.map(slot => `${slot.slot}: ${slot.label}（${slot.vehicleId}）`).join(" / ") || "なし"
      : value || "なし";
    for (const diff of diffs) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = `カード：${diff.app.label}`;
      const rows = Object.keys(titles).filter(key => JSON.stringify(diff.app[key]) !== JSON.stringify(diff.excel[key]))
        .map(key => [titles[key], display(diff.app[key]), display(diff.excel[key])]);
      section.append(heading, settingsTable(rows, ["項目", "現在", "読込後（Excel）"]));
      container.append(section);
    }
    if (!diffs.length) container.textContent = "既存カードの変更差分はありません。";
  }
  function historyReplacementText(result) {
    return `正式記録：追加${result.added}件・修正${result.updated}件・削除${result.removed}件。` +
      ` 仮登録から正式登録へ${result.finalized}件移行、未反映のアプリ記録${result.retained}件は保持します。`;
  }
  function selectedMasterTypes() {
    return [...$("masterChoices").querySelectorAll("input:checked")].map(input => input.value);
  }
  function renderMasterSelection() {
    const selected = selectedMasterTypes();
    const issues = [];
    for (const input of $("masterChoices").querySelectorAll("input")) {
      const files = masterFiles.filter(file => file.data.masterType === input.value);
      const count = files.length;
      const status = input.parentElement.querySelector("small");
      status.textContent = count > 1 ? (input.checked ? "重複あり" : "重複あり（対象外）")
        : count === 1 ? (input.checked ? "選択済" : "選択済（対象外）")
          : input.checked ? "ファイル不足" : "対象外";
      status.title = files.map(file => file.name).join("\n");
      const controls = input.closest(".master-choice").querySelector(".master-file-controls");
      controls.replaceChildren(...files.map(file => {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = count > 1 ? `${file.name}を外す` : "外す";
        remove.title = file.name;
        remove.setAttribute("aria-label", `${masterTitles[input.value]}：${file.name}を外す`);
        remove.onclick = () => {
          masterFiles.splice(masterFiles.indexOf(file), 1);
          clearMasterPreview();
          renderMasterSelection();
        };
        return remove;
      }));
      if (input.checked && count !== 1) issues.push(input.value);
    }
    if (!selected.length) issues.push("取り込む内容を選択してください。");
    if (!state?.settings.catalog && Object.keys(masterTitles).some(type =>
      type !== "OPPONENT_Master" && !selected.includes(type))) {
      issues.push("初回は対戦履歴以外の設定マスターをすべて選択してください。");
    }
    $("masterSelectionInfo").textContent = !selected.length ? "取り込む内容を選択してください。"
      : !state?.settings.catalog && Object.keys(masterTitles).some(type =>
        type !== "OPPONENT_Master" && !selected.includes(type))
        ? "初回は対戦履歴以外の設定マスターをすべて選択してください。"
        : issues.length ? "各項目のファイル不足・重複を確認してください。"
          : "内容を確認できます。";
    $("previewMasters").disabled = issues.length > 0;
  }
  for (const [type, title] of Object.entries(masterTitles)) {
    const row = document.createElement("div");
    row.className = "master-choice";
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = type;
    input.checked = dailyMasters.includes(type);
    input.onchange = () => { clearMasterPreview(); renderMasterSelection(); };
    const status = document.createElement("small");
    status.setAttribute("role", "status");
    label.append(input, document.createTextNode(title), status);
    const controls = document.createElement("div");
    controls.className = "master-file-controls";
    row.append(label, controls);
    $("masterChoices").append(row);
  }
  for (const button of document.querySelectorAll("[data-master-preset]")) {
    button.onclick = () => {
      for (const input of $("masterChoices").querySelectorAll("input")) {
        input.checked = button.dataset.masterPreset === "all" ||
          (button.dataset.masterPreset === "daily" && dailyMasters.includes(input.value));
      }
      clearMasterPreview();
      renderMasterSelection();
    };
  }
  $("addMasterFiles").onclick = () => $("masterFiles").click();
  $("masterFiles").onchange = event => {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    clearMasterPreview();
    void runMaster(async () => {
      const additions = await Promise.all(files.map(async file => {
        let data;
        try { data = JSON.parse(await file.text()); }
        catch (error) { throw new Error(`${file.name}を読み込めません：${error.message}`); }
        if (!Object.hasOwn(masterTitles, data?.masterType)) throw new Error(`${file.name}：未対応のマスター種類です。`);
        const selected = C.readSelectedMasters([data], [data.masterType]);
        if (data.masterType === "CARD_Master") data = { ...data, data: selected.masters.CARD_Master };
        if (data.masterType === "OPPONENT_Master") M.replaceHistory([], data);
        return { name: file.name, data };
      }));
      masterFiles.push(...additions);
      renderMasterSelection();
    }).finally(() => { $("masterFiles").value = ""; });
  };
  $("previewMasters").onclick = () => {
    clearMasterPreview();
    void runMaster(async () => {
      const { masters, history } = C.readSelectedMasters(masterFiles.map(file => file.data), selectedMasterTypes());
      if (!state.settings.catalog && Object.keys(masters).length !== 8) {
        throw new Error("初回は対戦履歴以外の設定マスターをすべて取り込んでください。");
      }
      const historyResult = history ? M.replaceHistory(state.records, history) : null;
      const importedSettings = Object.keys(masters).length ? C.mergeMasters(state.settings, masters) : state.settings;
      M.validateSettings(importedSettings);
      const diffs = C.masterCardDiffs(state.settings, masters);
      masterPreview = { masters, settings: JSON.stringify(state.settings),
        records: JSON.stringify(state.records), importedSettings, historyResult };
      showMasterDiffs(diffs);
      $("masterInfo").textContent = `${selectedMasterTypes().map(type => masterTitles[type]).join("、")}：内容を確認してください。` +
        " 選択した種類はJSONの内容で置き換えます。JSONにない旧定義は削除します。" +
        (historyResult ? ` ${historyReplacementText(historyResult)}` : "") +
        " 入力途中の下書きは保持します。";
      $("masterPreview").hidden = false;
      if (!$("settings").hidden) {
        const heading = $("masterPreviewHeading");
        heading.focus({ preventScroll: true });
        $("masterInfo").scrollIntoView({ block: "center" });
      }
    });
  };
  renderMasterSelection();
  $("cancelMasters").onclick = () => clearMasterPreview("取り込みを中止しました。");
  $("masterPreview").onsubmit = event => {
    event.preventDefault();
    void runMaster(async () => {
      if (!masterPreview) throw new Error("マスターを選択し直してください。");
      if (masterPreview.settings !== JSON.stringify(state.settings)) throw new Error("確認中に設定が変更されました。マスターを選択し直してください。");
      if (masterPreview.records !== JSON.stringify(state.records)) throw new Error("確認中に対戦記録が変更されました。マスターを選択し直してください。");
      const settings = masterPreview.importedSettings;
      M.validateSettings(settings);
      const next = structuredClone(state);
      next.settings = settings;
      if (masterPreview.historyResult) {
        next.records = masterPreview.historyResult.records;
        next.temporaryNoCounters = M.mergeTemporaryCounters(next.records,
          M.mergeTemporaryCounters(state.records, next.temporaryNoCounters));
      }
      if (!state.settings.catalog && !next.records.some(record => record.id === next.draft.id)) {
        next.draft.values = C.suggestContext(next.settings, next.draft.values);
      }
      await persist(next);
      state = next;
      renderDraft();
      renderRecords();
      renderSettings();
      const message = "選択したマスターをJSONの内容で置き換えました。" +
        (masterPreview.historyResult ? ` ${historyReplacementText(masterPreview.historyResult)}` : " 対戦記録は変更していません。") +
        " 入力途中の下書きは保持しました。";
      clearMasterPreview(message);
      renderMasterSelection();
    });
  };
  $("saveCardRank").onclick = () => run(async () => {
    const card = C.selectedCard(state.settings, state.draft.values);
    if (!card) throw new Error("登録カードを選択してください。");
    if (!confirm(`${card.label}の現在状態を「${state.draft.values.myRank} ${C.formatStars(state.draft.values.myStars)}」に更新します。過去の記録は変更しません。実機の現在状態を確認しましたか？`)) return;
    const profiles = C.profiles(state.settings);
    const profile = profiles.find(item => item.id === card.id);
    profile.rank = state.draft.values.myRank;
    profile.stars = state.draft.values.myStars;
    const next = structuredClone(state);
    next.settings = C.updateProfiles(state.settings, profiles, new Date().toISOString());
    await persist(next);
    state = next;
    renderSettings();
    $("pasteInfo").textContent = `${card.label}の現在ランク・星を端末内設定に保存しました。`;
  });
  function exportExcelCsv(from, to, info, requireConfirmation) {
    info.textContent = "";
    if (from && to && from > to) throw new Error("出力期間の開始日は終了日以前にしてください。");
    const records = state.records.filter(record => isAppRecord(record) &&
      (!from || record.values.date >= from) && (!to || record.values.date <= to))
      .sort((a, b) => a.values.date.localeCompare(b.values.date));
    if (!records.length) throw new Error("指定期間にCSV出力できるアプリの保存済み対戦がありません。");
    const text = M.toExcelCsv(records);
    if (requireConfirmation && !confirm(`${records.length}件をExcel貼り付け用CSVに出力します。\n対象：${from || "最初"} ～ ${to || "最後"}\n出力済みの記録も含みます。ExcelでX列の仮No.を確認し、二重転記を避けてください。\n仮No.のない旧記録は、日付・カード・対戦内容で確認してください。`)) return;
    const now = new Date();
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(value => String(value).padStart(2, "0")).join("");
    const time = [now.getHours(), now.getMinutes()].map(value => String(value).padStart(2, "0")).join("");
    download(`dac-${date}-${time}.csv`, text, "text/csv;charset=utf-8");
    info.textContent = `${records.length}件のCSVダウンロードを開始しました。見出しを除くA～Y列をコピーしてください。Excelへの転記完了を示すものではありません。`;
  }
  $("excelCsv").onclick = () => run(async () => {
    if (!$("excelFrom").checkValidity() || !$("excelTo").checkValidity()) throw new Error("出力期間の日付を確認してください。");
    exportExcelCsv($("excelFrom").value, $("excelTo").value, $("excelCsvInfo"), true);
  });
  $("quickCsv").onclick = () => run(async () => exportExcelCsv("", "", $("quickCsvInfo"), false));
  $("csv").onclick = () => run(async () => download("dac-history-import-v1.csv", M.toImportCsv(state.records), "text/csv;charset=utf-8"));
  $("backup").onclick = () => run(async () => download("dac-backup.json", backupText(), "application/json"));
  $("rescue").onclick = () => download("dac-rescue.json", backupText(), "application/json");
  $("importHistory").onchange = event => {
    const file = event.target.files[0];
    if (!file) return;
    void run(async () => {
      const data = JSON.parse(await file.text());
      const next = structuredClone(state);
      const replacement = data.masterType === "OPPONENT_Master" ? M.replaceHistory(state.records, data) : null;
      if (replacement && !confirm(`${historyReplacementText(replacement)}\nこの対戦履歴マスターを反映しますか？`)) return;
      next.records = replacement ? replacement.records : M.mergeHistory(next.records, data);
      next.temporaryNoCounters = M.mergeTemporaryCounters(next.records,
        M.mergeTemporaryCounters(state.records, next.temporaryNoCounters));
      const added = next.records.length - state.records.length;
      await persist(next);
      state = next;
      renderDraft();
      renderRecords();
      renderSettings();
      $("importInfo").textContent = replacement
        ? `${historyReplacementText(replacement)} 入力途中・設定は保持しました。`
        : `${added}件追加しました。同じ対戦IDは重複追加しません。入力途中・設定は保持しました。`;
    }).finally(() => { $("importHistory").value = ""; });
  };
  $("importHistoryCsv").onchange = event => {
    const file = event.target.files[0];
    if (!file) return;
    void run(async () => {
      const result = M.mergeImportCsv(state.records, await file.text());
      const next = structuredClone(state);
      next.records = result.records;
      next.temporaryNoCounters = M.mergeTemporaryCounters(next.records, next.temporaryNoCounters);
      await persist(next);
      state = next;
      renderDraft();
      renderRecords();
      renderSettings();
      $("importCsvInfo").textContent = `${result.added}件追加、${result.updated}件の不足項目を補完、${result.skipped}件変更なし。入力中・設定は保持しました。`;
    }).finally(() => { $("importHistoryCsv").value = ""; });
  };
  $("restore").onchange = event => {
    const file = event.target.files[0];
    if (!file) return;
    void run(async () => {
      const data = M.validateBackup(JSON.parse(await file.text()));
      if (!confirm(`${data.records.length}件の記録・下書き・設定で置き換えます。現在のバックアップは取得済みですか？`)) return;
      const next = { schema: 1, records: data.records, draft: data.draft, settings: C.compactGarages(C.cleanOpponentLists(data.settings)), paste: typeof data.paste === "string" ? data.paste : "" };
      if (data.settingsDraft) next.settingsDraft = data.settingsDraft;
      if (typeof data.playerSearch === "string") next.playerSearch = data.playerSearch;
      next.temporaryNoCounters = M.mergeTemporaryCounters([...state.records, ...next.records],
        state.temporaryNoCounters, data.temporaryNoCounters);
      await persist(next);
      state = next;
      renderDraft();
      renderSettings();
      renderRecords();
    }).finally(() => { $("restore").value = ""; });
  };
  $("persist").onclick = () => run(async () => {
    if (!navigator.storage?.persist) throw new Error("このブラウザは保持リクエストに対応していません。JSONバックアップを保管してください。");
    const granted = await navigator.storage.persist();
    $("storageInfo").textContent = granted
      ? "ストレージ保持が許可されました。ただしデータ削除・故障に備えバックアップが必要です。"
      : "保持は許可されませんでした。JSONバックアップを定期的に保管してください。";
  });
  $("checkUsage").onclick = () => { void updateUsage().catch(report); };
  $("showDiagnostics").onclick = async () => {
    try {
      const data = await updateUsage();
      if (resetComplete) return;
      $("diagnostics").value = JSON.stringify(data, null, 2);
      $("copyDiagnostics").disabled = false;
    } catch (error) { report(error); }
  };
  $("copyDiagnostics").onclick = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("コピー非対応です。表示中の診断情報を選択して手動でコピーしてください。");
      await navigator.clipboard.writeText($("diagnostics").value);
      if (!resetComplete) $("maintenanceInfo").textContent = "表示中の診断情報をコピーしました。対戦内容は含みません。";
    } catch (error) { report(error); }
  };
  $("refreshApp").onclick = () => run(async () => {
    await persist();
    location.reload();
  });
  $("cleanCaches").onclick = () => run(async () => {
    $("maintenanceInfo").textContent = "利用中・更新待ちの版を確認しています…";
    try {
      await offlineSetup;
      if (offlineSetupError) throw offlineSetupError;
      const count = await maintenance.cleanOldCaches(appScope);
      $("maintenanceInfo").textContent = `不要な旧版キャッシュを${count}世代整理しました。現在版・利用中・更新待ちの版と、記録・下書き・設定は保持しました。`;
    } catch (error) {
      $("maintenanceInfo").textContent = "キャッシュ整理は完了していません。一部だけ整理された可能性があります。記録・下書き・設定は変更していません。";
      throw error;
    }
  });
  $("clearOfficial").onclick = () => run(async () => {
    const counts = maintenanceCounts();
    if (!counts.official) throw new Error("消去できる正式な過去記録はありません。");
    if (!confirm(`正式な過去記録${counts.official}件を消去しますか？\nアプリ入力記録${counts.app}件・下書き・設定・仮No.の採番履歴は保持します。\n履歴検索の再利用には04のマスターの再読込が必要です。`)) return;
    const next = structuredClone(state);
    next.temporaryNoCounters = M.mergeTemporaryCounters(state.records, state.temporaryNoCounters);
    next.records = M.replaceHistory(state.records, { schema: 1, masterType: "OPPONENT_Master", records: [] }).records;
    await persist(next);
    state = next;
    clearMasterPreview();
    renderDraft();
    renderRecords();
    renderSettings();
    $("usageInfo").textContent = "データが変更されました。「使用状況を確認・更新」で再確認してください。";
    $("diagnostics").value = "";
    $("copyDiagnostics").disabled = true;
    $("maintenanceInfo").textContent = `正式な過去記録${counts.official}件を消去しました。アプリ入力記録・下書き・設定・採番履歴は保持しました。`;
  });
  $("resetApp").onclick = () => run(async () => {
    if (!$("resetBackupConfirmed").checked || !$("resetTabsConfirmed").checked) {
      throw new Error("JSONバックアップの保管と、ほかのアプリ用タブを閉じたことを確認し、両方にチェックしてください。");
    }
    const counts = maintenanceCounts();
    if (!confirm(`【取り消せません】\n正式記録${counts.official}件・アプリ入力記録${counts.app}件・下書き・全設定・採番履歴を消去します。\nこのアプリ用キャッシュとオフライン登録も消去します。\n最新JSONバックアップを保管済みで、このアプリを完全初期化してよいですか？`)) return;
    $("resetBackupConfirmed").checked = false;
    $("resetTabsConfirmed").checked = false;
    $("maintenanceInfo").textContent = "初期化中です。完了するまで操作せずお待ちください。";
    try {
      await offlineSetup;
      if (offlineSetupError) throw offlineSetupError;
      await maintenance.clearOffline(appScope);
      revision = await S.clear(db, revision);
    } catch (error) {
      $("maintenanceInfo").textContent = "初期化は完了していません。上部のエラーを確認してください。";
      throw new Error(`初期化は完了していません。オフライン登録やキャッシュだけが整理された可能性があります。記録・下書き・設定の消去は完了していません。\n${error.message}`);
    }
    finishReset();
  });
  if ("serviceWorker" in navigator && window.isSecureContext) {
    offlineSetup = navigator.serviceWorker.register("./sw.js").catch(error => {
      offlineSetupError = new Error(`オフライン機能の登録失敗：${error.message}`);
      report(offlineSetupError);
    });
  }
})();
