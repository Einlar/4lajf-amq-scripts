// ==UserScript==
// @name         AMQ Training Mode
// @namespace    https://github.com/4Lajf
// @version      0.75
// @description  Extended version of kempanator's Custom Song List Game Training mode allows you to practice your songs efficiently something line anki or other memory card software. It's goal is to give you songs that you don't recozniged mixed with some songs that you do recognize to solidify them in your memory.
// @match        https://animemusicquiz.com/*
// @author       4Lajf & kempanator
// @grant        GM_xmlhttpRequest
// @connect      myanimelist.net
// @require      https://github.com/joske2865/AMQ-Scripts/raw/master/common/amqScriptInfo.js
// @downloadURL  https://github.com/4Lajf/amq-scripts/raw/main/amqTrainingMode.user.js
// @updateURL    https://github.com/4Lajf/amq-scripts/raw/main/amqTrainingMode.user.js
// ==/UserScript==

/*
How to start a custom song list game:
  1. create a solo lobby
  2. click the CSL button in the top right
  3. click the autocomplete button if it is red
  4. create or upload a list in the song list tab
  5. change settings in the settings tab
  6. fix any invalid answers in the answer tab
  7. click training mode to start the quiz

Supported upload files:
  1. anisongdb json
  2. official AMQ song history export
  3. joseph song list script export
  4. blissfulyoshi ranked song list

Some considerations:
  1. anisongdb is unavailable during ranked, please prepare some json files in advance
  2. anime titles that were changed recently in AMQ will be incorrect if anisongdb never updated it
  3. no automatic volume equalizing
  4. If the song exists in multiple anime only anime in your list are being counted as acceptable answers.
*/

"use strict";
if (typeof Listener === "undefined") return;
let loadInterval = setInterval(() => {
    if ($("#loadingScreen").hasClass("hidden")) {
        clearInterval(loadInterval);
        setup();
    }
}, 500);

let previousAttemptData = null;
let isSearchMode = true;
let mySongList = [];
let finalSongList = [];
let correctSongsPerGame = 0;
let originalWeight = null;
let currentSongKey = null;
let incorrectSongsPerGame = 0;
let trainingLinkadded = false;
let ignoredSongs = [];
let currentSearchFilter = "";
let buttonContainerAdded = false;
let statsModal;
let maxNewSongs24Hours = 20;
let newSongsAdded24Hours = 0;
let lastResetTime = Date.now();
let potentialNewSongs = new Set();
const version = "0.75";
const saveData = validateLocalStorage("customSongListGame");
const catboxHostDict = { 1: "nl.catbox.video", 2: "ladist1.catbox.video", 3: "vhdist1.catbox.video" };
let currentProfile;
let profiles;
let isTraining = false;
let CSLButtonCSS = saveData.CSLButtonCSS || "calc(25% - 250px)";
let showCSLMessages = saveData.showCSLMessages ?? false;
let replacedAnswers = saveData.replacedAnswers || {};
let malClientId = saveData.malClientId ?? "";
let hotKeys = saveData.hotKeys ?? {};
let debug = Boolean(saveData.debug);
let fastSkip = false;
let nextVideoReady = false;
let showSelection = 1;
let guessTime = 20;
let extraGuessTime = 0;
let currentSong = 0;
let totalSongs = 0;
let currentAnswers = {};
let score = {};
let songListTableMode = 0; //0: song + artist, 1: anime + song type + vintage, 2: catbox links
let songListTableSort = [0, 0, 0, 0, 0, 0, 0, 0, 0]; //song, artist, difficulty, anime, type, vintage, mp3, 480, 720 (0: off, 1: ascending, 2: descending)
let songList = [];
let songOrder = {}; //{song#: index#, ...}
let mergedSongList = [];
let importedSongList = [];
let songOrderType = "random";
let startPointRange = [0, 100];
let difficultyRange = [0, 100];
let previousSongFinished = false;
let skipInterval;
let nextVideoReadyInterval;
let answerTimer;
let extraGuessTimer;
let endGuessTimer;
let fileHostOverride = 0;
let autocomplete = []; //store lowercase version for faster compare speed
let autocompleteInput;
let cslMultiplayer = { host: "", songInfo: {}, voteSkip: {} };
let cslState = 0; //0: none, 1: guessing phase, 2: answer phase
let songLinkReceived = {};
let skipping = false;
let answerChunks = {}; //store player answer chunks, ids are keys
let resultChunk;
let songInfoChunk;
let nextSongChunk;
let importRunning = false;

hotKeys.start = saveData.hotKeys?.start ?? { altKey: false, ctrlKey: false, key: "" };
hotKeys.stop = saveData.hotKeys?.stop ?? { altKey: false, ctrlKey: false, key: "" };
hotKeys.startTraining = saveData.hotKeys?.startTraining ?? { altKey: false, ctrlKey: false, key: "" };
hotKeys.stopTraining = saveData.hotKeys?.stopTraining ?? { altKey: false, ctrlKey: false, key: "" };
hotKeys.cslgWindow = saveData.hotKeys?.cslgWindow ?? { altKey: false, ctrlKey: false, key: "" };
//hotKeys.mergeAll = saveData.hotKeys?.mergeAll ?? {altKey: false, ctrlKey: false, key: ""};

function handleRepeatModeToggle() {
    $("#cslgSettingsRepeatMode").change(function () {
        const isEnabled = $(this).prop("checked");
        $("#cslgSettingsRepeatModeSlider, #cslgSettingsRepeatModeMin, #cslgSettingsRepeatModeMax").prop("disabled", !isEnabled);
        $("#cslgSettingsMaxNewSongs, #cslgSettingsMaxNewSongsRange, #cslgSettingsIncorrectSongs, #cslgSettingsIncorrectSongsRange, #cslgSettingsCorrectSongs, #cslgSettingsCorrectSongsRange").prop("disabled", isEnabled);
    });
}

function initializeSettingsContainer() {
    initializeSingleHandleSliders();
    initializeTwoWaySliders();
    loadTwoWaySliderSettings();
    initializeSliders();
    loadSettings();
    initializePopovers();
    handleRepeatModeToggle();

    // Event listener for the reset button
    $("#cslSettingsResetMaxNewSongs").click(function () {
        resetNewSongsCount();
        $("#cslgSettingsMaxNewSongs").val(maxNewSongs24Hours);
        $("#cslgSettingsMaxNewSongsRange").val(maxNewSongs24Hours);
        alert("New songs count has been reset for the next 24 hours.");
    });
}

function initializeTwoWaySliders() {
    $("#cslgSettingsStartPoint")
        .slider({
            min: 0,
            max: 100,
            value: [0, 100],
            range: true,
            tooltip: "hide",
        })
        .on("change", function (e) {
            startPointRange = e.value.newValue;
            $("#cslgSettingsStartPointMin").val(e.value.newValue[0]);
            $("#cslgSettingsStartPointMax").val(e.value.newValue[1]);
        });

    $("#cslgSettingsStartPointMin, #cslgSettingsStartPointMax").on("change", function () {
        let minVal = Math.max(0, parseInt($("#cslgSettingsStartPointMin").val()) || 0);
        let maxVal = Math.max(0, parseInt($("#cslgSettingsStartPointMax").val()) || 0);

        if (minVal > maxVal) {
            minVal = maxVal;
        }

        $("#cslgSettingsStartPointMin").val(minVal);
        $("#cslgSettingsStartPointMax").val(maxVal);
        $("#cslgSettingsStartPoint").slider("setValue", [minVal, maxVal]);
        startPointRange = [minVal, maxVal];
    });

    // Difficulty Range (2-way slider)
    $("#cslgSettingsDifficulty")
        .slider({
            min: 0,
            max: 100,
            value: [0, 100],
            range: true,
            tooltip: "hide",
        })
        .on("change", function (e) {
            difficultyRange = e.value.newValue;
            $("#cslgSettingsDifficultyMin").val(e.value.newValue[0]);
            $("#cslgSettingsDifficultyMax").val(e.value.newValue[1]);
        });

    $("#cslgSettingsDifficultyMin, #cslgSettingsDifficultyMax").on("change", function () {
        let minVal = Math.max(0, parseInt($("#cslgSettingsDifficultyMin").val()) || 0);
        let maxVal = Math.max(0, parseInt($("#cslgSettingsDifficultyMax").val()) || 0);

        if (minVal > maxVal) {
            minVal = maxVal;
        }

        $("#cslgSettingsDifficultyMin").val(minVal);
        $("#cslgSettingsDifficultyMax").val(maxVal);
        $("#cslgSettingsDifficulty").slider("setValue", [minVal, maxVal]);
        difficultyRange = [minVal, maxVal];
    });

    // Repeat Mode (2-way slider)
    $("#cslgSettingsRepeatMode")
        .slider({
            min: 1,
            max: 5,
            value: [1, 5],
            step: 0.01,
            range: true,
            tooltip: "hide",
        })
        .on("change", function (e) {
            $("#cslgSettingsRepeatModeMin").val(e.value.newValue[0].toFixed(2));
            $("#cslgSettingsRepeatModeMax").val(e.value.newValue[1].toFixed(2));
            // Update the repeat mode range in your settings
        });

    $("#cslgSettingsRepeatModeMin, #cslgSettingsRepeatModeMax").on("change", function () {
        let minVal = Math.max(1, Math.min(5, parseFloat($("#cslgSettingsRepeatModeMin").val()) || 1));
        let maxVal = Math.max(1, Math.min(5, parseFloat($("#cslgSettingsRepeatModeMax").val()) || 5));

        if (minVal > maxVal) {
            minVal = maxVal;
        }

        $("#cslgSettingsRepeatModeMin").val(minVal.toFixed(2));
        $("#cslgSettingsRepeatModeMax").val(maxVal.toFixed(2));
        $("#cslgSettingsRepeatMode").slider("setValue", [minVal, maxVal]);
        // Update the repeat mode range in your settings
    });
    initializeRepeatModeSwitch();
}

function initializeSingleHandleSliders() {
    const sliders = [
        { sliderId: "#cslgSettingsSongs", inputId: "#cslgSettingsSongsInput", min: 1, max: 100, defaultValue: 20, allowHigherInput: true },
        { sliderId: "#cslgSettingsGuessTime", inputId: "#cslgSettingsGuessTimeInput", min: 1, max: 99, defaultValue: 20, allowHigherInput: false },
        { sliderId: "#cslgSettingsExtraGuessTime", inputId: "#cslgSettingsExtraGuessTimeInput", min: 0, max: 15, defaultValue: 0, allowHigherInput: false },
        { sliderId: "#cslgSettingsMaxNewSongs", inputId: "#cslgSettingsMaxNewSongsInput", min: 0, max: 100, defaultValue: 20, allowHigherInput: true },
        { sliderId: "#cslgSettingsIncorrectSongs", inputId: "#cslgSettingsIncorrectSongsInput", min: 0, max: 20, defaultValue: 0, allowHigherInput: true },
        { sliderId: "#cslgSettingsCorrectSongs", inputId: "#cslgSettingsCorrectSongsInput", min: 0, max: 20, defaultValue: 0, allowHigherInput: true },
    ];

    sliders.forEach((slider) => {
        const $slider = $(slider.sliderId);
        const $input = $(slider.inputId);

        $slider.slider({
            min: slider.min,
            max: slider.max,
            value: $input.val() || slider.defaultValue,
            tooltip: "hide",
        }).on("slide", function(e) {
            $input.val(e.value);
            saveSettings();
        }).on("change", function(e) {
            $input.val(e.value.newValue);
            saveSettings();
        });

        $input.on("change", function() {
            let value = parseInt($(this).val());
            if (slider.allowHigherInput) {
                value = Math.max(slider.min, value);
            } else {
                value = Math.max(slider.min, Math.min(slider.max, value));
            }
            $(this).val(value);
            $slider.slider("setValue", value);
            saveSettings();
        });

        // Set initial value
        const initialValue = $input.val() || slider.defaultValue;
        $slider.slider("setValue", initialValue);
        $input.val(initialValue);
    });
}

function getSliderValue(sliderId, inputId) {
    const sliderValue = $(sliderId).slider("getValue");
    const inputValue = parseInt($(inputId).val());
    return Math.max(sliderValue, inputValue);
}

function initializeSliders() {
    // Song Order (slider with specific data points)
    $("#cslgSongOrder")
        .slider({
            ticks: [1, 2, 3],
            ticks_labels: ["Random", "Ascending", "Descending"],
            ticks_positions: [0, 50, 100], // Add this line
            min: 1,
            max: 3,
            step: 1,
            value: 1,
            tooltip: "hide",
        })
        .on("change", function (e) {
            songOrderType = ["random", "ascending", "descending"][e.value.newValue - 1];
        });

    // Override URL (slider with specific data points)
    $("#cslgHostOverride")
        .slider({
            ticks: [0, 1, 2, 3],
            ticks_labels: ["Default", "nl", "ladist1", "vhdist1"],
            ticks_positions: [0, 33, 66, 100], // Add this line
            min: 0,
            max: 3,
            step: 1,
            value: 0,
            tooltip: "hide",
        })
        .on("change", function (e) {
            fileHostOverride = e.value.newValue;
        });

    setTimeout(function () {
        $("#cslgSongOrder, #cslgHostOverride").slider("refresh");
    }, 0);
}

function initializeRepeatModeSwitch() {
    const $repeatModeSwitch = $("#cslgSettingsRepeatModeSwitch");
    const $repeatModeSlider = $("#cslgSettingsRepeatMode");
    const $repeatModeInputs = $("#cslgSettingsRepeatModeMin, #cslgSettingsRepeatModeMax");
    const $maxNewSongsSlider = $("#cslgSettingsMaxNewSongs");
    const $incorrectSongsSlider = $("#cslgSettingsIncorrectSongs");
    const $correctSongsSlider = $("#cslgSettingsCorrectSongs");

    function updateControlStates() {
        const isRepeatModeEnabled = $repeatModeSwitch.prop("checked");

        // Enable/disable Repeat Mode slider and inputs
        $repeatModeSlider.slider(isRepeatModeEnabled ? "enable" : "disable");
        $repeatModeInputs.prop("disabled", !isRepeatModeEnabled);

        // Enable/disable other sliders
        $maxNewSongsSlider.slider(isRepeatModeEnabled ? "disable" : "enable");
        $incorrectSongsSlider.slider(isRepeatModeEnabled ? "disable" : "enable");
        $correctSongsSlider.slider(isRepeatModeEnabled ? "disable" : "enable");

        // Update visual state
        $repeatModeSlider.closest(".form-group").toggleClass("disabled", !isRepeatModeEnabled);
        $maxNewSongsSlider.closest(".form-group").toggleClass("disabled", isRepeatModeEnabled);
        $incorrectSongsSlider.closest(".form-group").toggleClass("disabled", isRepeatModeEnabled);
        $correctSongsSlider.closest(".form-group").toggleClass("disabled", isRepeatModeEnabled);
    }

    $repeatModeSwitch.on("change", updateControlStates);

    // Initial state setup
    updateControlStates();
}

function loadTwoWaySliderSettings() {
    $("#cslgSettingsStartPoint").slider("setValue", startPointRange);
    $("#cslgSettingsStartPointMin").val(startPointRange[0]);
    $("#cslgSettingsStartPointMax").val(startPointRange[1]);

    $("#cslgSettingsDifficulty").slider("setValue", difficultyRange);
    $("#cslgSettingsDifficultyMin").val(difficultyRange[0]);
    $("#cslgSettingsDifficultyMax").val(difficultyRange[1]);

    $("#cslgSettingsRepeatModeSwitch").prop("checked", false);
    $("#cslgSettingsRepeatMode").slider("setValue", [1, 5]);
    $("#cslgSettingsRepeatModeMin").val("1.00");
    $("#cslgSettingsRepeatModeMax").val("5.00");
}

function loadSettings() {
    $("#cslgSettingsSongs").slider("setValue", totalSongs || 20);
    $("#cslgSettingsSongsInput").val(totalSongs || 20);

    $("#cslgSettingsGuessTime").slider("setValue", guessTime);
    $("#cslgSettingsGuessTimeInput").val(guessTime);

    $("#cslgSettingsExtraGuessTime").slider("setValue", extraGuessTime);
    $("#cslgSettingsExtraGuessTimeInput").val(extraGuessTime);

    $("#cslgSettingsFastSkip").prop("checked", fastSkip);

    $("#cslgSettingsOPCheckbox").prop("checked", true);
    $("#cslgSettingsEDCheckbox").prop("checked", true);
    $("#cslgSettingsINCheckbox").prop("checked", true);
    $("#cslgSettingsTVCheckbox").prop("checked", true);
    $("#cslgSettingsMovieCheckbox").prop("checked", true);
    $("#cslgSettingsOVACheckbox").prop("checked", true);
    $("#cslgSettingsONACheckbox").prop("checked", true);
    $("#cslgSettingsSpecialCheckbox").prop("checked", true);

    $("#cslgSettingsStartPoint").slider("setValue", startPointRange);
    $("#cslgSettingsDifficulty").slider("setValue", difficultyRange);
    $("#cslgSongOrder").slider("setValue", ["random", "ascending", "descending"].indexOf(songOrderType) + 1);
    $("#cslgHostOverride").slider("setValue", fileHostOverride);

    $("#cslgSettingsMaxNewSongs").slider("setValue", maxNewSongs24Hours || 20);
    $("#cslgSettingsMaxNewSongsInput").val(maxNewSongs24Hours || 20);

    $("#cslgSettingsIncorrectSongs").slider("setValue", incorrectSongsPerGame);
    $("#cslgSettingsIncorrectSongsInput").val(incorrectSongsPerGame);

    $("#cslgSettingsCorrectSongs").slider("setValue", correctSongsPerGame);
    $("#cslgSettingsCorrectSongsInput").val(correctSongsPerGame);

    $("#cslgSettingsRepeatModeSwitch").prop("checked", false);
    $("#cslgSettingsRepeatMode").slider("setValue", [1, 5]);
}

function saveSettings() {
    localStorage.setItem(
        "customSongListGame",
        JSON.stringify({
            replacedAnswers,
            CSLButtonCSS,
            debug,
            hotKeys,
            malClientId,
        })
    );

    totalSongs = getSliderValue("#cslgSettingsSongs", "#cslgSettingsSongsInput");
    guessTime = getSliderValue("#cslgSettingsGuessTime", "#cslgSettingsGuessTimeInput");
    extraGuessTime = getSliderValue("#cslgSettingsExtraGuessTime", "#cslgSettingsExtraGuessTimeInput");
    maxNewSongs24Hours = getSliderValue("#cslgSettingsMaxNewSongs", "#cslgSettingsMaxNewSongsInput");
    incorrectSongsPerGame = getSliderValue("#cslgSettingsIncorrectSongs", "#cslgSettingsIncorrectSongsInput");
    correctSongsPerGame = getSliderValue("#cslgSettingsCorrectSongs", "#cslgSettingsCorrectSongsInput");
    fastSkip = $("#cslgSettingsFastSkip").prop("checked");
    startPointRange = $("#cslgSettingsStartPoint").slider("getValue");
    difficultyRange = $("#cslgSettingsDifficulty").slider("getValue");
    songOrderType = ["random", "ascending", "descending"][$("#cslgSongOrder").slider("getValue") - 1];
    fileHostOverride = $("#cslgHostOverride").slider("getValue");
    saveNewSongsSettings();
}

function loadNewSongsSettings() {
    const settings = localStorage.getItem(`newSongsSettings_${currentProfile}`);
    if (settings) {
        const parsed = JSON.parse(settings);
        maxNewSongs24Hours = parsed.maxNewSongs24Hours;
        newSongsAdded24Hours = parsed.newSongsAdded24Hours;
        lastResetTime = parsed.lastResetTime;
        incorrectSongsPerGame = parsed.incorrectSongsPerGame || 0;
        correctSongsPerGame = parsed.correctSongsPerGame || 0;
    }
}

function createTrainingInfoPopup() {
    const popupHtml = `
        <div id="trainingInfoPopup" class="modal fade">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 class="modal-title">What's Training Mode?</h4>
                        <button type="button" class="close" data-dismiss="modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p>Training mode is a feature in CSL that allows you to practice and improve your anime song recognition skills. Here's how it works:</p>
                        <ul>
                            <li>Load songs you want to train on in the "Song List" tab.</li>
                            <li>The game selects songs based on a spaced repetition algorithm, prioritizing songs you need more practice with.</li>
                            <li>You receive immediate feedback on your answers, and the system adjusts song difficulty accordingly.</li>
                            <li>Your progress is recorded and used to optimize future training sessions.</li>
                            <li>You can manually adjust the frequency of specific songs appearing.</li>
                            <li>You can also "banish" a song by clicking the block button on the "Song List" menu.</li>
                            <li>That will cause the song to not play ever again and won't appear in the search results.</li>
                            <li>You can bring it back by checking "Show Banished Songs" and clicking the tick near the appropriate song.</li>
                            <li>Click on My Songs / Song Search button to swtich between modes.</li>
                            <li>In Song Search mode you can search for songs and add them to your My Songs list by clicking the Plus (+) icon.</li>
                            <li>If you click on the Plus (+) icon in My Songs mode than you will add it to Merge tab.</li>
                            <li>Use the big buttons to perform mass actions like adding all songs to My Songs all deleting every song from the list.</li>
                            <li>You can also change the table view by clicking the table icon.</li>
                            <li>Additionally you can customize your search by clicking Search Options</li>
                        </ul>
                        <p>Use training mode to efficiently improve your recognition of anime songs, focusing on those you find challenging!</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
  `;

    $("body").append(popupHtml);
}

function showTrainingInfo() {
    if (!$("#trainingInfoPopup").length) {
        createTrainingInfoPopup();
    }
    $("#trainingInfoPopup").modal("show");
}

function loadIgnoredSongs() {
    const savedIgnoredSongs = localStorage.getItem(`ignoredSongs_${currentProfile}`);
    if (savedIgnoredSongs) {
        ignoredSongs = JSON.parse(savedIgnoredSongs);
    }
}

function saveIgnoredSongs() {
    localStorage.setItem(`ignoredSongs_${currentProfile}`, JSON.stringify(ignoredSongs));
}

function blockSong(song) {
    if (isSearchMode) {
        songList = songList.filter((s) => s !== song);
    } else {
        mySongList = mySongList.filter((s) => s !== song);
    }
    ignoredSongs.push(song);
    saveIgnoredSongs();
    updateSongListDisplay();
}

function unblockSong(song) {
    ignoredSongs = ignoredSongs.filter((s) => s !== song);
    if (isSearchMode) {
        songList.push(song);
    } else {
        mySongList.push(song);
    }
    saveIgnoredSongs();
    updateSongListDisplay();
}

function filterSongList() {
    if (currentSearchFilter) {
        const searchCriteria = $("#cslgSearchCriteria").val();
        return songList.filter((song) => {
            const lowerCaseFilter = currentSearchFilter.toLowerCase();
            console.log("song info :", song);
            console.log("lowerCaseFilter:", lowerCaseFilter);
            console.log("searchCriteria:", searchCriteria);
            switch (searchCriteria) {
                case "songName":
                    return song.songName.toLowerCase().includes(lowerCaseFilter);
                case "songArtist":
                    return song.songArtist.toLowerCase().includes(lowerCaseFilter);
                case "animeName":
                    return song.animeRomajiName.toLowerCase().includes(lowerCaseFilter) || song.animeEnglishName.toLowerCase().includes(lowerCaseFilter);
                case "songType":
                    return songTypeText(song.songType, song.songTypeNumber).toLowerCase().includes(lowerCaseFilter);
                case "animeVintage":
                    return song.animeVintage.toLowerCase().includes(lowerCaseFilter);
                case "all":
                default:
                    return (
                        song.songName.toLowerCase().includes(lowerCaseFilter) ||
                        song.songArtist.toLowerCase().includes(lowerCaseFilter) ||
                        song.animeRomajiName.toLowerCase().includes(lowerCaseFilter) ||
                        song.animeEnglishName.toLowerCase().includes(lowerCaseFilter) ||
                        songTypeText(song.songType, song.songTypeNumber).toLowerCase().includes(lowerCaseFilter) ||
                        song.animeVintage.toLowerCase().includes(lowerCaseFilter) 
                    );
            }
        });
    }
    return songList;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function saveProfiles() {
    localStorage.setItem("cslProfiles", JSON.stringify(profiles));
}

function loadProfiles() {
    const savedProfiles = localStorage.getItem("cslProfiles");
    if (savedProfiles) {
        profiles = JSON.parse(savedProfiles);
        if (!profiles.includes("default")) {
            profiles.unshift("default");
        }
    } else {
        // If no profiles exist in localStorage, initialize with default
        profiles = ["default"];
    }
    // Ensure currentProfile is set
    if (!profiles.includes(currentProfile)) {
        currentProfile = "default";
    }
    // Save the profiles in case we made any changes
    saveProfiles();
}

// Function to select a profile
function selectProfile(profileName) {
    if (profiles.includes(profileName)) {
        currentProfile = profileName;
        updateProfileSelect();
        // Load the review data for the selected profile
        loadReviewData();
        console.log(`Selected profile: ${profileName}`);
    } else {
        console.error(`Profile ${profileName} does not exist`);
    }
}

// Function to add a new profile
function addProfile(profileName) {
    if (!profiles.includes(profileName)) {
        profiles.push(profileName);
        saveProfiles();
        updateProfileSelect();
        console.log(`Added new profile: ${profileName}`);
    } else {
        console.error(`Profile ${profileName} already exists`);
    }
}

// Function to delete a profile
function deleteProfile(profileName) {
    profiles = profiles.filter((p) => p !== profileName);
    localStorage.removeItem(`spacedRepetitionData_${profileName}`);
    saveProfiles();
    if (currentProfile === profileName) {
        selectProfile("default");
    } else {
        updateProfileSelect();
    }
    console.log(`Deleted profile: ${profileName}`);
}

function updateProfileSelect() {
    const $select = $("#cslgProfileSelect");
    $select.empty();
    profiles.forEach((profile) => {
        $select.append($("<option></option>").val(profile).text(profile));
    });
    $select.val(currentProfile);
}

$("#gameContainer").append(
    $(`
    <div class="modal fade tab-modal" id="cslgSettingsModal" tabindex="-1" role="dialog">
        <div class="modal-dialog" role="document" style="width: 800px">
            <div class="modal-content">
					<div class="modal-header" style="padding: 3px 0 0 0">
						<div class="modal-header-content">
							<span id="trainingInfoLink" class="training-info-link">What's Training?</span>
							<h4 class="modal-title">Custom Song List Game</h4>
							<button type="button" class="close" data-dismiss="modal" aria-label="Close">
								<span aria-hidden="true">×</span>
							</button>
						</div>
						<div class="tabContainer">
                        <div id="cslgSongListTab" class="tab clickAble selected">
                            <h5>Song List</h5>
                        </div>
                        <div id="cslgQuizSettingsTab" class="tab clickAble">
                            <h5>Settings</h5>
                        </div>
                        <div id="cslgMergeTab" class="tab clickAble">
                            <h5>Merge</h5>
                        </div>
                        <div id="cslgAnswerTab" class="tab clickAble">
                            <h5>Answers</h5>
                        </div>
                        <div id="cslgHotkeyTab" class="tab clickAble">
                            <h5>Hotkey</h5>
                        </div>
                        <div id="cslgListImportTab" class="tab clickAble">
                            <h5>List Import</h5>
                        </div>
                        <div id="cslgInfoTab" class="tab clickAble" style="width: 45px; margin-right: -10px; padding-right: 8px; float: right;">
                            <h5><i class="fa fa-info-circle" aria-hidden="true"></i></h5>
                        </div>
                    </div>
                </div>
                <div class="modal-body" style="overflow-y: auto; max-height: calc(100vh - 150px);">
                    <div id="cslgSongListContainer" class="dark-theme">
                        <div class="cslg-header">
							<div class="cslg-header-row">
								<div class="cslg-mode-selector">
									<button id="cslgToggleModeButton" class="btn btn-primary btn-sm">Song Search</button>
									<label for="cslgFileUpload" class="btn btn-outline-light btn-sm ml-2">
										<i class="fa fa-upload"></i> Upload List
										<input id="cslgFileUpload" type="file" style="display:none;">
									</label>
								</div>
								<div class="cslg-actions">
									<button id="cslgAddAllButton" class="btn-icon"><i class="fa fa-plus-square"></i></button>
									<button id="cslgClearSongListButton" class="btn-icon"><i class="fa fa-trash"></i></button>
									<button id="cslgTransferSongListButton" class="btn-icon"><i class="fa fa-exchange"></i></button>
									<button id="cslgTableModeButton" class="btn-icon""><i class="fa fa-table"></i></button>
								</div>
							</div>
							<div class="cslg-header-row">
								<div class="cslg-search">
									<select id="cslgSearchCriteria" class="form-control form-control-sm bg-dark text-light">
										<option value="all">All</option>
										<option value="songName">Song Name</option>
										<option value="songArtist">Song Artist</option>
										<option value="animeName">Anime Name</option>
										<option value="songType">Song Type</option>
										<option value="animeVintage">Anime Vintage</option>
									</select>
									<input id="cslgSearchInput" type="text" class="form-control form-control-sm bg-dark text-light" placeholder="filter songs...">
								</div>
								<div class="cslg-counts">
									<span id="cslgSongListCount" class="badge bg-secondary">Songs: 0</span>
									<span id="cslgMergedSongListCount" class="badge bg-secondary">Merged: 0</span>
								</div>
							</div>
							<div class="cslg-header-row anisongdb-search-row">
								<div class="cslg-anisongdb-search">
									<select id="cslgAnisongdbModeSelect" class="form-control form-control-sm bg-dark text-light">
										<option>Anime</option>
										<option>Artist</option>
										<option>Song</option>
										<option>Composer</option>
										<option>Season</option>
										<option>Ann Id</option>
										<option>Mal Id</option>
									</select>
									<input id="cslgAnisongdbQueryInput" type="text" class="form-control form-control-sm bg-dark text-light" placeholder="Add songs..." />
								</div>
								<div class="cslg-options">
									<button id="songOptionsButton" class="btn btn-secondary btn-sm">Search Options</button>
								</div>

								<div class="song-options-backdrop"></div>
								<div class="song-options-popup">
									<span class="song-options-close">&times;</span>
									<h6>Song Types</h6>
									<div class="checkbox-group">
										<label><input id="cslgAnisongdbOPCheckbox" type="checkbox" checked> OP</label>
										<label><input id="cslgAnisongdbEDCheckbox" type="checkbox" checked> ED</label>
										<label><input id="cslgAnisongdbINCheckbox" type="checkbox" checked> IN</label>
									</div>
									<h6>Search Options</h6>
									<div class="checkbox-group">
										<label><input id="cslgAnisongdbPartialCheckbox" type="checkbox" checked> Partial Match</label>
										<label><input id="cslgAnisongdbIgnoreDuplicatesCheckbox" type="checkbox"> Ignore Duplicates</label>
										<label><input id="cslgAnisongdbArrangementCheckbox" type="checkbox"> Arrangement</label>
									</div>
								</div>
							</div>
							<div class="cslg-header-row anisongdb-search-row">
								<div class="cslg-advanced-options">
									<label class="input-group input-group-sm">
										<span class="input-group-text bg-dark text-light">Max Other</span>
										<input id="cslgAnisongdbMaxOtherPeopleInput" type="number" class="form-control form-control-sm bg-dark text-light" min="0" max="99" value="99">
									</label>
									<label class="input-group input-group-sm">
										<span class="input-group-text bg-dark text-light">Min Group</span>
										<input id="cslgAnisongdbMinGroupMembersInput" type="number" class="form-control form-control-sm bg-dark text-light" min="0" max="99" value="0">
									</label>
								</div>
								<div class="cslg-show-ignored">
									<button id="cslgShowIgnoredButton" class="btn btn-secondary btn-sm">Show Banished Songs</button>
								</div>
							</div>
						</div>
                        <div class="cslg-table-container">
                            <table id="cslgSongListTable" class="table table-dark table-striped table-hover">
                                <thead>
                                    <tr>
                                        <th class="number">#</th>
                                        <th class="song">Song</th>
                                        <th class="artist">Artist</th>
                                        <th class="difficulty">Dif</th>
                                        <th class="action">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                </tbody>
                            </table>
                            <div id="cslgSongListWarning"></div>
                        </div>
                    </div>
						<div id="cslgQuizSettingsContainer" class="container-fluid">
                            <div class="row">
                                <div class="col-md-6">
                                <div class="cslg-settings-section">
                                    <h3>Quiz Settings</h3>
                                    <div class="form-group">
                                        <label for="cslgSettingsSongs">Number of Songs:</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <div style="flex-grow: 1; margin-right: 10px;">
                                            <input id="cslgSettingsSongs" type="text" data-slider-min="1" data-slider-max="100" data-slider-step="1" data-slider-value="20" style="width: 250px;"/>
                                            </div>
                                            <input type="number" id="cslgSettingsSongsInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                        </div>
                                    <div class="form-group">
                                        <label for="cslgSettingsGuessTime">Guess Time (seconds):</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <div style="flex-grow: 1; margin-right: 10px;">
                                            <input id="cslgSettingsGuessTime" type="text" data-slider-min="1" data-slider-max="99" data-slider-step="1" data-slider-value="20" style="width: 250px;"/>
                                            </div>
                                            <input type="number" id="cslgSettingsGuessTimeInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                        </div>
                                    <div class="form-group">
                                        <label for="cslgSettingsExtraGuessTime">Extra Time (seconds):</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <div style="flex-grow: 1; margin-right: 10px;">
                                            <input id="cslgSettingsExtraGuessTime" type="text" data-slider-min="0" data-slider-max="15" data-slider-step="1" data-slider-value="0" style="width: 250px;"/>
                                            </div>
                                            <input type="number" id="cslgSettingsExtraGuessTimeInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                        </div>
                                    <div class="form-group">
                                    <div class="custom-control custom-switch">
                                        <input type="checkbox" class="custom-control-input" id="cslgSettingsFastSkip">
                                        <label class="custom-control-label" for="cslgSettingsFastSkip">Fast Skip</label>
                                    </div>
                                    </div>
                                </div>
                                </div>

                                <div class="col-md-6">
                                <div class="cslg-settings-section">
                                    <h3>Song Selection</h3>
                                    <div class="form-group">
                                        <label for="cslgSettingsStartPoint">Sample Range:</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <input type="number" class="number-to-text" id="cslgSettingsStartPointMin" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                            <div style="flex-grow: 1; margin: 0 10px;">
                                            <input id="cslgSettingsStartPoint" type="text" data-slider-min="0" data-slider-max="100" data-slider-step="1" data-slider-value="[0,100]" style="width: 100%;"/>
                                            </div>
                                            <input type="number" class="number-to-text" id="cslgSettingsStartPointMax" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label for="cslgSettingsDifficulty">Difficulty Range:</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <input type="number" class="number-to-text" id="cslgSettingsDifficultyMin" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                            <div style="flex-grow: 1; margin: 0 10px;">
                                            <input id="cslgSettingsDifficulty" type="text" data-slider-min="0" data-slider-max="100" data-slider-step="1" data-slider-value="[0,100]" style="width: 100%;"/>
                                            </div>
                                            <input type="number" class="number-to-text" id="cslgSettingsDifficultyMax" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                    </div>
                                    <div class="cslg-setting-row" style="display: flex; align-items: center; margin-bottom: 5px;">
                                        <label style="flex: 0 0 100px; margin-bottom: 0;">Song Types:</label>
                                        <div style="display: flex; align-items: center;">
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsOPCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">OP</span>
                                            </label>
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsEDCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">ED</span>
                                            </label>
                                            <label style="display: flex; align-items: center;">
                                                <input id="cslgSettingsINCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">IN</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div class="cslg-setting-row" style="display: flex; align-items: center;">
                                        <label style="flex: 0 0 100px; margin-bottom: 0;">Anime Types:</label>
                                        <div style="display: flex; align-items: center;">
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsTVCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">TV</span>
                                            </label>
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsMovieCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">Movie</span>
                                            </label>
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsOVACheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">OVA</span>
                                            </label>
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsONACheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">ONA</span>
                                            </label>
                                            <label style="display: flex; align-items: center;">
                                                <input id="cslgSettingsSpecialCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">Special</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                </div>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                <div class="cslg-settings-section">
                                    <h3>Advanced Settings</h3>
                                    <div class="form-group">
                                    <label for="cslgSongOrder">Song Order:</label>
                                    <input id="cslgSongOrder" type="text" style="width: 250px;" data-slider-ticks="[1, 2, 3]" data-slider-ticks-labels='["Random", "Ascending", "Descending"]' data-slider-min="1" data-slider-max="3" data-slider-step="1" data-slider-value="1"/>
                                    </div>
                                    <div class="form-group">
                                    <label for="cslgHostOverride">Override URL:</label>
                                    <input id="cslgHostOverride" type="text" style="width: 250px;" data-slider-ticks="[0, 1, 2, 3]" data-slider-ticks-labels='["Default", "nl", "ladist1", "vhdist1"]' data-slider-min="0" data-slider-max="3" data-slider-step="1" data-slider-value="0"/>
                                    </div>
                                </div>
                                </div>

                                <div class="col-md-6">
                                <div class="cslg-settings-section">
                                    <h3>Training Mode Settings</h3>
                                    <div class="form-group">
                                            <label for="cslgSettingsMaxNewSongs">Max New Songs (24h):</label>
                                            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                                <div style="flex-grow: 1; margin-right: 10px;">
                                                    <input id="cslgSettingsMaxNewSongs" style="width: 250px;" type="text" data-slider-min="0" data-slider-max="100" data-slider-step="1" data-slider-value="25"/>
                                                </div>
                                                <input type="number" id="cslgSettingsMaxNewSongsInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                                <button id="cslSettingsResetMaxNewSongs" class="btn btn-sm" style="margin-left: 10px;">Reset</button>
                                            </div>
                                            <i class="fa fa-info-circle" id="maxNewSongsInfo" aria-hidden="true"></i>
                                        </div>
                                        <div class="form-group">
                                            <label for="cslgSettingsIncorrectSongs">Incorrect Songs per Game:</label>
                                            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                                <div style="flex-grow: 1; margin-right: 10px;">
                                                    <input id="cslgSettingsIncorrectSongs" style="width: 250px;" type="text" data-slider-min="0" data-slider-max="20" data-slider-step="1" data-slider-value="0"/>
                                                </div>
                                                <input type="number" id="cslgSettingsIncorrectSongsInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                            </div>
                                            <i class="fa fa-info-circle" id="incorrectSongsInfo" aria-hidden="true"></i>
                                        </div>
                                            <div class="form-group">
                                                <label for="cslgSettingsCorrectSongs">Correct Songs per Game:</label>
                                                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                                    <div style="flex-grow: 1; margin-right: 10px;">
                                                        <input id="cslgSettingsCorrectSongs" style="width: 250px;" type="text" data-slider-min="0" data-slider-max="20" data-slider-step="1" data-slider-value="0"/>
                                                    </div>
                                                    <input type="number" id="cslgSettingsCorrectSongsInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                                </div>
                                                <i class="fa fa-info-circle" id="correctSongsInfo" aria-hidden="true"></i>
                                            </div>
                                        <label for="cslgSettingsRepeatMode">Repeat Mode:</label>
                                            <div class="custom-control custom-switch mb-2">
                                                <input type="checkbox" class="custom-control-input" id="cslgSettingsRepeatModeSwitch">
                                                <label class="custom-control-label" for="cslgSettingsRepeatModeSwitch">Enable</label>
                                                <i class="fa fa-info-circle" id="repeatModeInfo" aria-hidden="true" style="margin-left: 5px;"></i>
                                            </div>
                                    <div class="form-group">
                                            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                                <input type="number" class="number-to-text" id="cslgSettingsRepeatModeMin" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;" step="0.01">
                                                <div style="flex-grow: 1; margin: 0 10px;">
                                                <input id="cslgSettingsRepeatMode" type="text" data-slider-min="1" data-slider-max="5" data-slider-step="0.01" data-slider-value="[1,5]" style="width: 100%;"/>
                                                </div>
                                                <input type="number" class="number-to-text" id="cslgSettingsRepeatModeMax" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;" step="0.01">
                                            </div>
                                        </div>
                                </div>
                                </div>
                            </div>
                            </div>
                    <div id="cslgAnswerContainer">
                        <span style="font-size: 16px; font-weight: bold;">Old:</span>
                        <input id="cslgOldAnswerInput" type="text" style="width: 240px; color: black; margin: 10px 0;">
                        <span style="font-size: 16px; font-weight: bold; margin-left: 10px;">New:</span>
                        <input id="cslgNewAnswerInput" type="text" style="width: 240px; color: black; margin: 10px 0;">
                        <button id="cslgAnswerButtonAdd" style="color: black; margin-left: 10px;">Add</button>
                        <div id="cslgAnswerText" style="font-size: 16px; font-weight: bold;">No list loaded</div>
                        <div style="height: 300px; margin: 5px 0; overflow-y: scroll;">
                            <table id="cslgAnswerTable" class="styledTable">
                                <thead>
                                    <tr>
                                        <th class="oldName">Old</th>
                                        <th class="newName">New</th>
                                        <th class="edit"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                </tbody>
                            </table>
                        </div>
                        <p style="margin-top: 5px">Use this window to replace invalid answers from your imported song list with valid answers from AMQ's autocomplete.</p>
                    </div>
                    <div id="cslgMergeContainer">
                        <h4 style="text-align: center; margin-bottom: 10px;">Merge multiple song lists into 1 JSON file</h4>
                        <div style="width: 400px; display: inline-block;">
                            <div id="cslgMergeCurrentCount" style="font-size: 16px; font-weight: bold;">Current song list: 0 songs</div>
                            <div id="cslgMergeTotalCount" style="font-size: 16px; font-weight: bold;">Merged song list: 0 songs</div>
                        </div>
                        <div style="display: inline-block; vertical-align: 13px">
                            <button id="cslgMergeButton" class="btn btn-default">Merge</button>
                            <button id="cslgMergeClearButton" class="btn btn-warning">Clear</button>
                            <button id="cslgMergeDownloadButton" class="btn btn-success">Download</button>
                        </div>
                        <div style="height: 400px; margin: 5px 0; overflow-y: scroll;">
                            <table id="cslgMergedSongListTable" class="styledTable">
                                <thead>
                                    <tr>
                                        <th class="number">#</th>
                                        <th class="anime">Anime</th>
                                        <th class="songType">Type</th>
                                        <th class="action"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                </tbody>
                            </table>
                        </div>
                        <p style="margin-top: 30px; display: none;">1. Load some songs into the table in the song list tab<br>2. Come back to this tab<br>3. Click "merge" to add everything from that list to a new combined list<br>4. Repeat steps 1-3 as many times as you want<br>5. Click "download" to download the new json file<br>6. Upload the file in the song list tab and play</p>
                    </div>
                    <div id="cslgHotkeyContainer">
                        <table id="cslgHotkeyTable">
                            <thead>
                                <tr>
                                    <th>Action</th>
                                    <th>Modifier</th>
                                    <th>Key</th>
                                </tr>
                            </thead>
                            <tbody>
                            </tbody>
                        </table>
                    </div>
                    <div id="cslgListImportContainer" style="text-align: center; margin: 10px 0;">
                        <h4 style="">Import list from username</h4>
                        <div>
                            <select id="cslgListImportSelect" style="padding: 3px 0; color: black;">
                                <option>myanimelist</option>
                                <option>anilist</option>
                            </select>
                            <input id="cslgListImportUsernameInput" type="text" placeholder="username" style="width: 200px; color: black;">
                            <button id="cslgListImportStartButton" style="color: black;">Go</button>
                        </div>
                        <div style="margin-top: 5px">
                            <label class="clickAble">Watching<input id="cslgListImportWatchingCheckbox" type="checkbox" checked></label>
                            <label class="clickAble" style="margin-left: 10px">Completed<input id="cslgListImportCompletedCheckbox" type="checkbox" checked></label>
                            <label class="clickAble" style="margin-left: 10px">On Hold<input id="cslgListImportHoldCheckbox" type="checkbox" checked></label>
                            <label class="clickAble" style="margin-left: 10px">Dropped<input id="cslgListImportDroppedCheckbox" type="checkbox" checked></label>
                            <label class="clickAble" style="margin-left: 10px">Planning<input id="cslgListImportPlanningCheckbox" type="checkbox" checked></label>
                        </div>
                        <h4 id="cslgListImportText" style="margin-top: 10px;"></h4>
                        <div id="cslgListImportActionContainer" style="display: none;">
                            <button id="cslgListImportMoveButton" style="color: black;">Move To Song List</button>
                            <button id="cslgListImportDownloadButton" style="color: black;">Download</button>
                        </div>
                    </div>
                    <div id="cslgInfoContainer" style="text-align: center; margin: 10px 0;">
                        <h4>Script Info</h4>
                        <div>Created by: kempanator (training mode by 4Lajf)</div>
                        <div>Version: ${version}</div>
                        <div><a href="https://github.com/kempanator/amq-scripts/blob/main/amqCustomSongListGame.user.js" target="blank">Github</a> <a href="https://github.com/kempanator/amq-scripts/raw/main/amqCustomSongListGame.user.js" target="blank">Install</a></div>
                        <h4 style="margin-top: 20px;">Custom CSS</h4>
                        <div><span style="font-size: 15px; margin-right: 17px;">#lnCustomSongListButton </span>right: <input id="cslgCSLButtonCSSInput" type="text" style="width: 150px; color: black;"></div>
                        <div style="margin: 10px 0"><button id="cslgResetCSSButton" style="color: black; margin-right: 10px;">Reset</button><button id="cslgApplyCSSButton" style="color: black;">Save</button></div>
                        <h4 style="margin-top: 20px;">Prompt All Players</h4>
                        <div style="margin: 10px 0"><button id="cslgPromptAllAutocompleteButton" style="color: black; margin-right: 10px;">Autocomplete</button><button id="cslgPromptAllVersionButton" style="color: black;">Version</button></div>
                        <div style="margin-top: 15px"><span style="font-size: 16px; margin-right: 10px; vertical-align: middle;">Show CSL Messages</span><div class="customCheckbox" style="vertical-align: middle"><input type="checkbox" id="cslgShowCSLMessagesCheckbox"><label for="cslgShowCSLMessagesCheckbox"><i class="fa fa-check" aria-hidden="true"></i></label></div></div>
                        <div style="margin: 10px 0"><input id="cslgMalClientIdInput" type="text" placeholder="MAL Client ID" style="width: 300px; color: black;"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <div style="float: left; margin-right: 10px;">
                        <select id="cslgProfileSelect" style="color: black; margin-right: 5px;"></select>
                        <button id="cslgLoadProfileButton" class="btn btn-default">Load</button>
                        <button id="cslgAddProfileButton" class="btn btn-success">Add</button>
                        <button id="cslgDeleteProfileButton" class="btn btn-danger">Delete</button>
                    </div>
                    <button id="cslgAutocompleteButton" class="btn btn-danger" style="float: left">Autocomplete</button>
                    <button id="cslgStartButton" class="btn btn-primary">Normal</button>
                    <button id="cslTrainingModeButton" class="btn btn-primary" >Training</button>
                </div>
            </div>
        </div>
    </div>
    `)
);

loadProfiles(); // Load saved profiles
updateProfileSelect(); // Populate profile select

// Load saved settings
loadNewSongsSettings();
$("#cslgSettingsMaxNewSongs").val(maxNewSongs24Hours);

// Load profile button
$("#cslgLoadProfileButton").click(() => {
    const selectedProfile = $("#cslgProfileSelect").val();
    if (selectedProfile) {
        selectProfile(selectedProfile);
        alert(`Loaded profile: ${selectedProfile}`);
    }
});

// Add profile button
$("#cslgAddProfileButton").click(() => {
    const profileName = prompt("Enter new profile name:");
    if (profileName) {
        addProfile(profileName);
        alert(`Added new profile: ${profileName}`);
    }
});

// Delete profile button
$("#cslgDeleteProfileButton").click(() => {
    const selectedProfile = $("#cslgProfileSelect").val();
    if (confirm(`Are you sure you want to delete the profile "${selectedProfile}"?`)) {
        deleteProfile(selectedProfile);
        alert(`Deleted profile: ${selectedProfile}`);
    }
});

createHotkeyElement("Start CSL", "start", "cslgStartHotkeySelect", "cslgStartHotkeyInput");
createHotkeyElement("Stop CSL", "stop", "cslgStopHotkeySelect", "cslgStopHotkeyInput");
createHotkeyElement("Start Training", "startTraining", "cslgStartTrainingHotkeySelect", "cslgStartTrainingHotkeyInput");
createHotkeyElement("Stop Training", "stopTraining", "cslgStopTrainingHotkeySelect", "cslgStopTrainingHotkeyInput");
createHotkeyElement("Open Window", "cslgWindow", "cslgWindowHotkeySelect", "cslgWindowHotkeyInput");
//createHotkeyElement("Merge All", "mergeAll", "cslgMergeAllHotkeySelect", "cslgMergeAllHotkeyInput");

function validateTrainingStart() {
    isTraining = true;
    if (!lobby.inLobby) return;
    songOrder = {};
    if (!lobby.isHost) {
        return messageDisplayer.displayMessage("Unable to start", "must be host");
    }
    if (lobby.numberOfPlayers !== lobby.numberOfPlayersReady) {
        return messageDisplayer.displayMessage("Unable to start", "all players must be ready");
    }
    if (!mySongList || !mySongList.length) {
        return messageDisplayer.displayMessage("Unable to start", "no songs in My Songs list");
    }
    if (autocomplete.length === 0) {
        return messageDisplayer.displayMessage("Unable to start", "autocomplete list empty");
    }
    let numSongs = getSliderValue("#cslgSettingsSongs", "#cslgSettingsSongsInput");
    if (isNaN(numSongs) || numSongs < 1) {
        return messageDisplayer.displayMessage("Unable to start", "invalid number of songs");
    }
    guessTime = getSliderValue("#cslgSettingsGuessTime", "#cslgSettingsGuessTimeInput");
    if (isNaN(guessTime) || guessTime < 1 || guessTime > 99) {
        return messageDisplayer.displayMessage("Unable to start", "invalid guess time");
    }
    extraGuessTime = getSliderValue("#cslgSettingsExtraGuessTime", "#cslgSettingsExtraGuessTimeInput");
    if (isNaN(extraGuessTime) || extraGuessTime < 0 || extraGuessTime > 15) {
        return messageDisplayer.displayMessage("Unable to start", "invalid extra guess time");
    }
    startPointRange = $("#cslgSettingsStartPoint").slider("getValue");
    if (startPointRange[0] < 0 || startPointRange[0] > 100 || startPointRange[1] < 0 || startPointRange[1] > 100 || startPointRange[0] > startPointRange[1]) {
        return messageDisplayer.displayMessage("Unable to start", "song start sample must be a range 0-100");
    }
    difficultyRange = $("#cslgSettingsDifficulty").slider("getValue");
    if (difficultyRange[0] < 0 || difficultyRange[0] > 100 || difficultyRange[1] < 0 || difficultyRange[1] > 100 || difficultyRange[0] > difficultyRange[1]) {
        return messageDisplayer.displayMessage("Unable to start", "difficulty must be a range 0-100");
    }

    let repeatMode = $("#cslgSettingsRepeatModeSwitch").prop("checked");
    if (repeatMode) {
        let range = $("#cslgSettingsRepeatMode").slider("getValue");
        if (range[0] >= range[1]) {
            return messageDisplayer.displayMessage("Unable to start", "invalid difficulty range for Repeat Mode");
        }
    } else {
        incorrectSongsPerGame = getSliderValue("#cslgSettingsIncorrectSongs", "#cslgSettingsIncorrectSongsInput");
        correctSongsPerGame = getSliderValue("#cslgSettingsCorrectSongs", "#cslgSettingsCorrectSongsInput");
        if (incorrectSongsPerGame + correctSongsPerGame > numSongs) {
            let adjustedIncorrect = Math.floor(numSongs / 2);
            let adjustedCorrect = numSongs - adjustedIncorrect;
            incorrectSongsPerGame = adjustedIncorrect;
            correctSongsPerGame = adjustedCorrect;
            $("#cslgSettingsIncorrectSongs").slider("setValue", adjustedIncorrect);
            $("#cslgSettingsCorrectSongs").slider("setValue", adjustedCorrect);
            saveNewSongsSettings();
            console.log(`Adjusted incorrectSongsPerGame to ${adjustedIncorrect} and correctSongsPerGame to ${adjustedCorrect} to match total songs per game`);
        }
    }

    currentSearchFilter = "";
    $("#cslgSearchInput").val("");
    $("#cslgSearchCriteria").val("all");
    let ops = $("#cslgSettingsOPCheckbox").prop("checked");
    let eds = $("#cslgSettingsEDCheckbox").prop("checked");
    let ins = $("#cslgSettingsINCheckbox").prop("checked");
    let tv = $("#cslgSettingsTVCheckbox").prop("checked");
    let movie = $("#cslgSettingsMovieCheckbox").prop("checked");
    let ova = $("#cslgSettingsOVACheckbox").prop("checked");
    let ona = $("#cslgSettingsONACheckbox").prop("checked");
    let special = $("#cslgSettingsSpecialCheckbox").prop("checked");

    let filteredSongs = mySongList.filter((song) => {
        // Type check for song.songType (can be either string or number)
        let passesTypeFilter = false;
        if (typeof song.songType === 'number') {
            // Handle as a number (assuming 1 = Opening, 2 = Ending, 3 = Insert)
            passesTypeFilter = (ops && song.songType === 1) ||
                (eds && song.songType === 2) ||
                (ins && song.songType === 3);
        } else if (typeof song.songType === 'string') {
            // Handle as a string (check if it contains "Opening", "Ending", or "Insert")
            let songType = String(song.songType);  // Ensure it's a string
            passesTypeFilter = (ops && songType.includes("Opening")) ||
                (eds && songType.includes("Ending")) ||
                (ins && songType.includes("Insert"));
        } else {
            console.log("Unknown songType format:", song.songType);
        }
        let passesAnimeTypeFilter = (tv && song.animeType === "TV") || (movie && song.animeType === "Movie") || (ova && song.animeType === "OVA") || (ona && song.animeType === "ONA") || (special && song.animeType === "Special");
        return passesTypeFilter && passesAnimeTypeFilter && difficultyFilter(song, difficultyRange[0], difficultyRange[1]);
    });

    if (filteredSongs.length === 0) {
        return messageDisplayer.displayMessage("Unable to start", "no songs match the specified criteria");
    }

    // Prepare the playlist from the filtered songs
    let playlist = prepareSongForTraining(filteredSongs, numSongs);

    // Create songOrder based on the playlist
    playlist.forEach((song, i) => {
        songOrder[i + 1] = mySongList.indexOf(song); // Store the index in mySongList
    });

    totalSongs = Object.keys(songOrder).length;
    if (totalSongs === 0) {
        return messageDisplayer.displayMessage("Unable to start", "no songs match the specified criteria");
    }
    fastSkip = $("#cslgSettingsFastSkip").prop("checked");
    $("#cslgSettingsModal").modal("hide");
    console.log("song order: ", songOrder);
    if (lobby.soloMode) {
        console.log(mySongList);
        startQuiz(filteredSongs);
    } else if (lobby.isHost) {
        cslMessage("§CSL0" + btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? "1" : "0"}`));
    }
}

$("#cslgAddAllButton")
    .click(() => {
        if (isSearchMode) {
            // Add all search results to My Songs
            const newSongs = songList.filter((song) => !mySongList.some((mySong) => mySong.songName === song.songName && mySong.songArtist === song.songArtist && mySong.animeRomajiName === song.animeRomajiName));
            mySongList = mySongList.concat(newSongs);
            gameChat.systemMessage(`Added ${newSongs.length} songs to My Songs list.`);
        } else {
            // Add all My Songs to merged list (original functionality)
            mergedSongList = Array.from(new Set(mergedSongList.concat(mySongList).map((x) => JSON.stringify(x)))).map((x) => JSON.parse(x));
            createMergedSongListTable();
            gameChat.systemMessage(`Added ${mySongList.length} songs to the merged list.`);
        }
    })
    .popover({
        content: () => (isSearchMode ? "Add all to My Songs" : "Add all to merged"),
        trigger: "hover",
        placement: "bottom",
    });

// Update the popover content when switching modes
$("#cslgToggleModeButton").click(function () {
    isSearchMode = !isSearchMode;
    updateModeDisplay();

    // Clear search input and reset filter when switching modes
    $("#cslgSearchInput").val("");
    currentSearchFilter = "";

    // Additional actions when switching to My Songs mode
    if (!isSearchMode) {
        $("#cslgAnisongdbQueryInput").val("");
        // You might want to clear or reset other search-related fields here
    }

    // Refresh the song list display
    updateSongListDisplay();
});

$("#cslTrainingModeButton").click(() => {
    validateTrainingStart();
});

$("#cslgSettingsModal").on("shown.bs.modal", function () {
    updateModeDisplay();
});

$("#lobbyPage .topMenuBar").append(`<div id="lnStatsButton" class="clickAble topMenuButton topMenuMediumButton"><h3>Stats</h3></div>`);
$("#lnStatsButton").click(() => {
    console.log("Stats Button Clicked");
    openStatsModal();
});
$("#lobbyPage .topMenuBar").append(`<div id="lnCustomSongListButton" class="clickAble topMenuButton topMenuMediumButton"><h3>CSL</h3></div>`);
$("#lnCustomSongListButton").click(() => {
    console.log("CSL Button Clicked");
    openSettingsModal();
});
$("#cslgSongListTab").click(() => {
    tabReset();
    $("#cslgSongListTab").addClass("selected");
    $("#cslgSongListContainer").show();
});
$("#cslgQuizSettingsTab").click(() => {
    tabReset();
    $("#cslgQuizSettingsTab").addClass("selected");
    $("#cslgQuizSettingsContainer").show();
});
$("#cslgAnswerTab").click(() => {
    tabReset();
    $("#cslgAnswerTab").addClass("selected");
    $("#cslgAnswerContainer").show();
});
$("#cslgMergeTab").click(() => {
    tabReset();
    $("#cslgMergeTab").addClass("selected");
    $("#cslgMergeContainer").show();
});
$("#cslgHotkeyTab").click(() => {
    tabReset();
    $("#cslgHotkeyTab").addClass("selected");
    $("#cslgHotkeyContainer").show();
});
$("#cslgListImportTab").click(() => {
    tabReset();
    $("#cslgListImportTab").addClass("selected");
    $("#cslgListImportContainer").show();
});
$("#cslgInfoTab").click(() => {
    tabReset();
    $("#cslgInfoTab").addClass("selected");
    $("#cslgInfoContainer").show();
});
$("#cslgAnisongdbSearchButtonGo").click(() => {
    anisongdbDataSearch();
});
$("#cslgAnisongdbQueryInput").keypress((event) => {
    if (event.which === 13) {
        anisongdbDataSearch();
    }
});
$("#cslgFileUpload").on("change", function () {
    if (this.files.length) {
        this.files[0].text().then((data) => {
            try {
                mySongList = [];
                handleData(JSON.parse(data));
                console.log("data: ", data);
                mySongList = finalSongList;
                songList = [];
                if (mySongList.length === 0) {
                    messageDisplayer.displayMessage("0 song links found");
                }
            } catch (error) {
                mySongList = [];
                $(this).val("");
                console.error(error);
                messageDisplayer.displayMessage("Upload Error");
            }
            setSongListTableSort();
            isSearchMode = false;
            $("#cslgToggleModeButton").text("My Songs");
            updateSongListDisplay();
            createAnswerTable();
        });
    }
});

$("#cslgMergeAllButton")
    .click(() => {
        mergedSongList = Array.from(new Set(mergedSongList.concat(songList).map((x) => JSON.stringify(x)))).map((x) => JSON.parse(x));
        createMergedSongListTable();
    })
    .popover({
        content: "Add all to merged",
        trigger: "hover",
        placement: "bottom",
    });

function clearSongList() {
    const showIgnored = $("#cslgShowIgnoredButton").hasClass("active");
    if (showIgnored) {
        ignoredSongs = [];
        saveIgnoredSongs();
    } else if (isSearchMode) {
        songList = [];
    } else {
        mySongList = [];
    }
    updateSongListDisplay();
}

$("#cslgShowIgnoredButton").click(function () {
    let isShowing = $(this).text() === "Hide Banished Songs";
    $(this).text(isShowing ? "Show Banished Songs" : "Hide Banished Songs");
});

$("#cslgClearSongListButton")
    .click(clearSongList)
    .popover({
        content: () => ($("#cslgShowIgnoredCheckbox").prop("checked") ? "Clear banished songs" : "Clear song list"),
        trigger: "hover",
        placement: "bottom",
    });
$("#cslgTransferSongListButton")
    .click(() => {
        if (isSearchMode) {
            // Transfer merged songs to search results
            songList = Array.from(mergedSongList);
            gameChat.systemMessage(`Transferred ${mergedSongList.length} songs from merged list to search results.`);
        } else {
            // Transfer merged songs to My Songs
            const newSongs = mergedSongList.filter((song) => !mySongList.some((mySong) => mySong.songName === song.songName && mySong.songArtist === song.songArtist && mySong.animeRomajiName === song.animeRomajiName));
            mySongList = mySongList.concat(newSongs);
            gameChat.systemMessage(`Transferred ${newSongs.length} new songs from merged list to My Songs.`);
        }
        updateSongListDisplay();
    })
    .popover({
        content: () => (isSearchMode ? "Transfer from merged to search results" : "Transfer from merged to My Songs"),
        trigger: "hover",
        placement: "bottom",
    });
$("#cslgTableModeButton")
    .click(() => {
        songListTableMode = (songListTableMode + 1) % 3;
        createSongListTable();
    })
    .popover({
        content: "Table mode",
        trigger: "hover",
        placement: "bottom",
    });
$("#cslgSongOrderSelect").on("change", function () {
    songOrderType = this.value;
});
$("#cslgHostOverrideSelect").on("change", function () {
    fileHostOverride = parseInt(this.value);
});
$("#cslgMergeButton").click(() => {
    mergedSongList = Array.from(new Set(mergedSongList.concat(songList).map((x) => JSON.stringify(x)))).map((x) => JSON.parse(x));
    createMergedSongListTable();
});
$("#cslgMergeClearButton").click(() => {
    mergedSongList = [];
    createMergedSongListTable();
});
$("#cslgMergeDownloadButton").click(() => {
    if (mergedSongList.length) {
        let data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(mergedSongList));
        let element = document.createElement("a");
        element.setAttribute("href", data);
        element.setAttribute("download", "merged.json");
        document.body.appendChild(element);
        element.click();
        element.remove();
    } else {
        messageDisplayer.displayMessage("No songs", "add some songs to the merged song list");
    }
});
$("#cslgAutocompleteButton").click(() => {
    if (lobby.soloMode) {
        $("#cslgSettingsModal").modal("hide");
        socket.sendCommand({ type: "lobby", command: "start game" });
        let autocompleteListener = new Listener("get all song names", () => {
            autocompleteListener.unbindListener();
            viewChanger.changeView("main");
            setTimeout(() => {
                hostModal.displayHostSolo();
            }, 200);
            setTimeout(() => {
                let returnListener = new Listener("Host Game", (payload) => {
                    returnListener.unbindListener();
                    if (songList.length) createAnswerTable();
                    setTimeout(() => {
                        openSettingsModal();
                    }, 10);
                });
                returnListener.bindListener();
                roomBrowser.host();
            }, 400);
        });
        autocompleteListener.bindListener();
    } else {
        messageDisplayer.displayMessage("Autocomplete", "For multiplayer, just start the quiz normally and immediately lobby");
    }
});
$("#cslgListImportUsernameInput").keypress((event) => {
    if (event.which === 13) {
        startImport();
    }
});
$("#cslgListImportStartButton").click(() => {
    startImport();
});
$("#cslgListImportMoveButton").click(() => {
    if (!importedSongList.length) return;
    handleData(importedSongList);
    setSongListTableSort();
    createSongListTable();
    createAnswerTable();
});
$("#cslgListImportDownloadButton").click(() => {
    if (!importedSongList.length) return;
    let listType = $("#cslgListImportSelect").val();
    let username = $("#cslgListImportUsernameInput").val().trim();
    let date = new Date();
    let dateFormatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, 0)}-${String(date.getDate()).padStart(2, 0)}`;
    let data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(importedSongList));
    let element = document.createElement("a");
    element.setAttribute("href", data);
    element.setAttribute("download", `${username} ${listType} ${dateFormatted} song list.json`);
    document.body.appendChild(element);
    element.click();
    element.remove();
});
$("#cslgStartButton").click(() => {
    validateStart();
});

$("#cslgSearchCriteria, #cslgSearchInput").on("change input", function () {
    currentSearchFilter = $("#cslgSearchInput").val().toLowerCase();
    createSongListTable();
});

$("#cslgShowIgnoredButton").click(function () {
    $(this).toggleClass("active");
    let isShowing = $(this).hasClass("active");
    $(this).text(isShowing ? "Hide Banished Songs" : "Show Banished Songs");
    createSongListTable();
});

$("#cslgSongListTable").on("click", "i.clickAble", function (event) {
    const $row = $(this).closest("tr");
    const showIgnored = $("#cslgShowIgnoredButton").hasClass("active");
    const currentList = showIgnored ? ignoredSongs : isSearchMode ? songList : mySongList;
    const index = $row.index();
    const song = currentList[index];

    if (!song) {
        console.error("Song not found");
        return;
    }

    if ($(this).hasClass("fa-ban")) {
        blockSong(song);
    } else if ($(this).hasClass("fa-check")) {
        unblockSong(song);
    } else if ($(this).hasClass("fa-trash")) {
        if (showIgnored) {
            ignoredSongs = ignoredSongs.filter(s => s !== song);
            saveIgnoredSongs();
        } else if (isSearchMode) {
            songList = songList.filter(s => s !== song);
        } else {
            mySongList = mySongList.filter(s => s !== song);
            console.log("My Song list: " , mySongList);
        }
    } else if ($(this).hasClass("fa-plus")) {
        if (isSearchMode) {
            if (!mySongList.some(s => s.songName === song.songName && s.songArtist === song.songArtist && s.animeRomajiName === song.animeRomajiName)) {
                mySongList.push(song);
                gameChat.systemMessage(`Added "${song.songName}" to My Songs list.`);
            } else {
                gameChat.systemMessage(`"${song.songName}" is already in My Songs list.`);
            }
        } else {
            mergedSongList.push(song);
            mergedSongList = Array.from(new Set(mergedSongList.map(x => JSON.stringify(x)))).map(x => JSON.parse(x));
            createMergedSongListTable();
        }
    }

    updateSongListDisplay();
});

$("#cslgSongListTable")
    .on("mouseenter", "i.fa-trash", (event) => {
        event.target.parentElement.parentElement.classList.add("selected");
    })
    .on("mouseleave", "i.fa-trash", (event) => {
        event.target.parentElement.parentElement.classList.remove("selected");
    })
    .on("mouseenter", "i.fa-ban", (event) => {
        event.target.parentElement.parentElement.classList.add("selected");
    })
    .on("mouseleave", "i.fa-ban", (event) => {
        event.target.parentElement.parentElement.classList.remove("selected");
    })
    .on("mouseenter", "i.fa-check", (event) => {
        event.target.parentElement.parentElement.classList.add("selected");
    })
    .on("mouseleave", "i.fa-check", (event) => {
        event.target.parentElement.parentElement.classList.remove("selected");
    });

$("#cslgSongListTable")
    .on("mouseenter", "i.fa-plus", (event) => {
        event.target.parentElement.parentElement.classList.add("selected");
    })
    .on("mouseleave", "i.fa-plus", (event) => {
        event.target.parentElement.parentElement.classList.remove("selected");
    });
$("#cslgAnswerButtonAdd").click(() => {
    let oldName = $("#cslgOldAnswerInput").val().trim();
    let newName = $("#cslgNewAnswerInput").val().trim();
    if (oldName) {
        newName ? (replacedAnswers[oldName] = newName) : delete replacedAnswers[oldName];
        saveSettings();
        createAnswerTable();
    }
    console.log("replaced answers: ", replacedAnswers);
});
$("#cslgAnswerTable").on("click", "i.fa-pencil", (event) => {
    let oldName = event.target.parentElement.parentElement.querySelector("td.oldName").innerText;
    let newName = event.target.parentElement.parentElement.querySelector("td.newName").innerText;
    $("#cslgOldAnswerInput").val(oldName);
    $("#cslgNewAnswerInput").val(newName);
});
$("#cslgMergedSongListTable")
    .on("click", "i.fa-chevron-up", (event) => {
        let index = parseInt(event.target.parentElement.parentElement.querySelector("td.number").innerText) - 1;
        if (index !== 0) {
            [mergedSongList[index], mergedSongList[index - 1]] = [mergedSongList[index - 1], mergedSongList[index]];
            createMergedSongListTable();
        }
    })
    .on("mouseenter", "i.fa-chevron-up", (event) => {
        event.target.parentElement.parentElement.classList.add("selected");
    })
    .on("mouseleave", "i.fa-chevron-up", (event) => {
        event.target.parentElement.parentElement.classList.remove("selected");
    });
$("#cslgMergedSongListTable")
    .on("click", "i.fa-chevron-down", (event) => {
        let index = parseInt(event.target.parentElement.parentElement.querySelector("td.number").innerText) - 1;
        if (index !== mergedSongList.length - 1) {
            [mergedSongList[index], mergedSongList[index + 1]] = [mergedSongList[index + 1], mergedSongList[index]];
            createMergedSongListTable();
        }
    })
    .on("mouseenter", "i.fa-chevron-down", (event) => {
        event.target.parentElement.parentElement.classList.add("selected");
    })
    .on("mouseleave", "i.fa-chevron-down", (event) => {
        event.target.parentElement.parentElement.classList.remove("selected");
    });
$("#cslgMergedSongListTable")
    .on("click", "i.fa-trash", (event) => {
        let index = parseInt(event.target.parentElement.parentElement.querySelector("td.number").innerText) - 1;
        mergedSongList.splice(index, 1);
        createMergedSongListTable();
    })
    .on("mouseenter", "i.fa-trash", (event) => {
        event.target.parentElement.parentElement.classList.add("selected");
    })
    .on("mouseleave", "i.fa-trash", (event) => {
        event.target.parentElement.parentElement.classList.remove("selected");
    });
$("#cslgSongListModeSelect")
    .val("Anisongdb")
    .on("change", function () {
        songList = [];
        $("#cslgSongListTable tbody").empty();
        $("#cslgMergeCurrentCount").text("Current song list: 0 songs");
        $("#cslgSongListCount").text("Songs: 0");
        if (this.value === "Anisongdb") {
            $("#cslgFileUploadRow").hide();
            $("#cslgAnisongdbSearchRow").show();
            $("#cslgFileUploadRow input").val("");
        } else if (this.value === "Load File") {
            $("#cslgAnisongdbSearchRow").hide();
            $("#cslgFileUploadRow").show();
            $("#cslgAnisongdbQueryInput").val("");
        }
    });
$("#cslgAnisongdbModeSelect").val("Artist");
/*$("#cslgAnisongdbModeSelect").val("Artist").on("change", function() {
    if (this.value === "Composer") {
        $("#cslgAnisongdbArrangementCheckbox").parent().show();
    }
    else {
        $("#cslgAnisongdbArrangementCheckbox").parent().hide();
    }
});*/
$("#cslgAnisongdbPartialCheckbox").prop("checked", true);
$("#cslgAnisongdbOPCheckbox").prop("checked", true);
$("#cslgAnisongdbEDCheckbox").prop("checked", true);
$("#cslgAnisongdbINCheckbox").prop("checked", true);
$("#cslgAnisongdbMaxOtherPeopleInput").val("99");
$("#cslgAnisongdbMinGroupMembersInput").val("0");
//$("#cslgAnisongdbArrangementCheckbox").parent().hide();
$("#cslgSettingsSongs").val("20");
$("#cslgSettingsGuessTime").val("20");
$("#cslgSettingsExtraGuessTime").val("0");
$("#cslgSettingsOPCheckbox").prop("checked", true);
$("#cslgSettingsEDCheckbox").prop("checked", true);
$("#cslgSettingsINCheckbox").prop("checked", true);
$("#cslgSettingsCorrectGuessCheckbox").prop("checked", true);
$("#cslgSettingsIncorrectGuessCheckbox").prop("checked", true);
$("#cslgSettingsTVCheckbox").prop("checked", true);
$("#cslgSettingsMovieCheckbox").prop("checked", true);
$("#cslgSettingsOVACheckbox").prop("checked", true);
$("#cslgSettingsONACheckbox").prop("checked", true);
$("#cslgSettingsSpecialCheckbox").prop("checked", true);
$("#cslgSettingsStartPoint").val("0-100");
$("#cslgSettingsDifficulty").val("0-100");
$("#cslgSettingsMaxNewSongs").val("25");
$("#cslgSettingsFastSkip").prop("checked", false);
$("#cslgFileUploadRow").hide();
$("#cslgCSLButtonCSSInput").val(CSLButtonCSS);
$("#cslgResetCSSButton").click(() => {
    CSLButtonCSS = "calc(25% - 250px)";
    $("#cslgCSLButtonCSSInput").val(CSLButtonCSS);
});
$("#cslgApplyCSSButton").click(() => {
    let val = $("#cslgCSLButtonCSSInput").val();
    if (val) {
        CSLButtonCSS = val;
        saveSettings();
        applyStyles();
    } else {
        messageDisplayer.displayMessage("Error");
    }
});
$("#cslgShowCSLMessagesCheckbox")
    .prop("checked", showCSLMessages)
    .click(() => {
        showCSLMessages = !showCSLMessages;
    });
$("#cslgPromptAllAutocompleteButton").click(() => {
    cslMessage("§CSL21");
});
$("#cslgPromptAllVersionButton").click(() => {
    cslMessage("§CSL22");
});
$("#cslgMalClientIdInput")
    .val(malClientId)
    .on("change", function () {
        malClientId = this.value;
        saveSettings();
    });
tabReset();
$("#cslgSongListTab").addClass("selected");
$("#cslgSongListContainer").show();

function saveReviewData(reviewData) {
    localStorage.setItem(`spacedRepetitionData_${currentProfile}`, JSON.stringify(reviewData));
}

function loadReviewData() {
    const data = localStorage.getItem(`spacedRepetitionData_${currentProfile}`);
    return data ? JSON.parse(data) : {};
}

function saveNewSongsSettings() {
    localStorage.setItem(
        `newSongsSettings_${currentProfile}`,
        JSON.stringify({
            maxNewSongs24Hours,
            newSongsAdded24Hours,
            lastResetTime,
            incorrectSongsPerGame,
            correctSongsPerGame,
        })
    );
}

function updateEFactor(oldEFactor, qualityOfResponse) {
    // Ensure that the quality of response is between 0 and 5
    qualityOfResponse = Math.max(0, Math.min(qualityOfResponse, 5));

    // Adjust the rate of E-Factor decrease for incorrect answers to be less severe
    const incorrectResponseFactor = 0.06; // Was 0.08 in the original formula
    const incorrectResponseSlope = 0.01; // Was 0.02 in the original formula

    // Adjust the rate of E-Factor increase for correct answers to be more substantial
    const correctResponseBonus = 0.15; // Was 0.1 in the original formula, can be increased if needed

    let newEFactor = oldEFactor + (correctResponseBonus - (5 - qualityOfResponse) * (incorrectResponseFactor + (5 - qualityOfResponse) * incorrectResponseSlope));

    newEFactor = Math.max(Math.min(newEFactor, 5), 1);

    return newEFactor;
}

function getReviewState(track) {
    const reviewData = loadReviewData();
    const songKey = `${track.songArtist}_${track.songName}`;
    const lastReview = reviewData[songKey] || {
        date: Date.now(),
        efactor: 2.5,
        successCount: 0,
        successStreak: 0,
        failureCount: 0,
        failureStreak: 0,
        isLastTryCorrect: false,
        weight: 9999,
        lastFiveTries: [],
        manualWeightAdjustment: 1,
    };

    return {
        ...track,
        reviewState: {
            date: lastReview.lastReviewDate || Date.now(),
            efactor: lastReview.efactor,
            successCount: lastReview.successCount,
            successStreak: lastReview.successStreak,
            failureCount: lastReview.failureCount,
            failureStreak: lastReview.failureStreak,
            isLastTryCorrect: lastReview.isLastTryCorrect,
            weight: lastReview.weight,
            lastFiveTries: lastReview.lastFiveTries,
            manualWeightAdjustment: lastReview.manualWeightAdjustment,
        },
        weight: lastReview.weight,
    };
}

function updateNewSongsCount(songKey) {
    if (potentialNewSongs.has(songKey)) {
        newSongsAdded24Hours++;
        potentialNewSongs.delete(songKey);
        console.log(`New song played: ${songKey}. Total new songs in 24 hours: ${newSongsAdded24Hours}`);
        saveNewSongsSettings();
    }
}

// Update the reviewSong function
function reviewSong(song, success) {
    console.log(song);
    if (!isTraining) return;
    let reviewData = loadReviewData();
    const songKey = `${song.songArtist}_${song.songName}`;

    if (!reviewData[songKey]) {
        reviewData[songKey] = {
            date: Date.now(),
            efactor: 2.5,
            successCount: 0,
            successStreak: 0,
            failureCount: 0,
            failureStreak: 0,
            isLastTryCorrect: false,
            weight: 9999,
            lastFiveTries: [],
            manualWeightAdjustment: 1,
        };
    }

    // Store the previous attempt data
    previousAttemptData = {
        songKey: songKey,
        ...JSON.parse(JSON.stringify(reviewData[songKey])) // Deep copy of the current state
    };

    const grade = success ? 5 : 0;
    const lastReview = reviewData[songKey];
    lastReview.efactor = updateEFactor(lastReview.efactor, grade);

    if (success) {
        lastReview.failureStreak = 0;
        lastReview.successStreak++;
        lastReview.successCount++;
    } else {
        lastReview.successStreak = 0;
        lastReview.failureStreak++;
        lastReview.failureCount++;
    }

    lastReview.isLastTryCorrect = success;
    lastReview.lastReviewDate = Date.now();

    // Update lastFiveTries
    lastReview.lastFiveTries.push(success);
    if (lastReview.lastFiveTries.length > 5) {
        lastReview.lastFiveTries.shift();
    }

    // Calculate and store the new weight
    lastReview.weight = calculateWeight({
        reviewState: lastReview,
    });

    console.log(reviewData);
    saveReviewData(reviewData);

    // Update new songs count after the song has been reviewed
    updateNewSongsCount(songKey);
}

let appearanceCounter = {};

function calculateWeight(track, reviewData) {
    if (!isTraining) return;
    const OVERDUE_FACTOR_PERCENTAGE = 0.1;
    const LAST_PERFORMANCE_PERCENTAGE = 0.15;
    const EFACTOR_IMPACT_PERCENTAGE = 0.5;
    const CORRECT_GUESSES_PERCENTAGE_INFLUENCE = 0.25;
    const SUCCESS_STREAK_INFLUENCE = -0.2;
    const FAILURE_STREAK_INFLUENCE = 0.3;

    const currentDate = Date.now();
    let reviewState;
    if (track) {
        reviewState = track.reviewState;
    } else {
        reviewState = reviewData;
    }
    const reviewDate = reviewState.date;
    const efactor = reviewState.efactor;
    const successCount = reviewState.successCount;
    const failureCount = reviewState.failureCount;
    const successStreak = reviewState.successStreak;
    const failureStreak = reviewState.failureStreak;

    // Focus on last 5 tries
    const last5Tries = reviewState.lastFiveTries || [];
    const attemptCount = last5Tries.length;
    const recentCorrectRatio = attemptCount > 0 ? last5Tries.filter((attempt) => attempt).length / attemptCount : 0;

    function calculateSuccessStreakImpact(successStreak, influence, cap) {
        let multiplier = Math.pow(2, successStreak);
        multiplier = Math.min(multiplier, cap);
        return multiplier * influence;
    }

    function calculateFailureStreakImpact(failureStreak, influence, cap) {
        let multiplier = Math.pow(2, failureStreak);
        multiplier = Math.min(multiplier, cap);
        return multiplier * influence;
    }

    let successStreakImpact = calculateSuccessStreakImpact(successStreak, SUCCESS_STREAK_INFLUENCE, 4);
    let failureStreakImpact = calculateFailureStreakImpact(failureStreak, FAILURE_STREAK_INFLUENCE, 4);

    const MIN_EFACTOR = 1.0;
    const intervalIncreaseFactor = Math.max(MIN_EFACTOR, efactor) * (1 + recentCorrectRatio);

    const idealReviewDate = reviewDate + intervalIncreaseFactor * (24 * 60 * 60 * 1000) - 2 * (24 * 60 * 60 * 1000);
    let overdueFactor = Math.max(0, (currentDate - idealReviewDate) / (24 * 60 * 60 * 1000));
    overdueFactor /= 10;

    const lastPerformance = reviewState.isLastTryCorrect ? 1 : 0;

    const efactorImpact = (5 - efactor) / 4;

    // Scale down the importance based on the number of attempts
    const scaleFactor = Math.min(1, attemptCount / 5);
    let correctGuessPercentageInfluence = (1 - recentCorrectRatio) * CORRECT_GUESSES_PERCENTAGE_INFLUENCE * scaleFactor;

    let weight = overdueFactor * OVERDUE_FACTOR_PERCENTAGE + (1 - lastPerformance) * LAST_PERFORMANCE_PERCENTAGE + efactorImpact * EFACTOR_IMPACT_PERCENTAGE + successStreakImpact + failureStreakImpact + correctGuessPercentageInfluence;
    weight *= 100;
    weight += 100;

    weight *= reviewState.manualWeightAdjustment;

    console.log(`
    Ideal review date: ${new Date(idealReviewDate).toISOString()}
    OverdueFactor: ${overdueFactor * OVERDUE_FACTOR_PERCENTAGE}
    LastPerformance: ${(1 - lastPerformance) * LAST_PERFORMANCE_PERCENTAGE}
    EFactorImpact: ${efactorImpact * EFACTOR_IMPACT_PERCENTAGE}
    SuccessStreakImpact: ${successStreakImpact}
    FailureStreakImpact: ${failureStreakImpact}
    CorrectGuessPercentage: ${correctGuessPercentageInfluence}
    RecentCorrectRatio: ${recentCorrectRatio}
    AttemptCount: ${attemptCount}
    ScaleFactor: ${scaleFactor}
    ManualWeightAdjustment: ${reviewState.manualWeightAdjustment}
    FINAL WEIGHT: ${weight / 100}`);

    return weight;
}

function weightedRandomSelection(reviewCandidates, maxSongs) {
    const centerWeight = 175;

    const candidatesArray = reviewCandidates.map((candidate) => {
        return {
            ...candidate,
            adjustedWeight: adjustWeight(candidate.reviewState.weight),
        };
    });

    function adjustWeight(weight) {
        const weightDifferenceRatio = (weight - centerWeight) / centerWeight;
        return weight * Math.pow(2, weightDifferenceRatio);
    }

    let totalAdjustedWeight = candidatesArray.reduce((total, candidate) => total + candidate.adjustedWeight, 0);

    const selectRandomly = () => {
        let r = Math.random() * totalAdjustedWeight;
        for (let i = 0; i < candidatesArray.length; i++) {
            r -= candidatesArray[i].adjustedWeight;
            if (r <= 0) {
                return candidatesArray[i];
            }
        }
    };

    const selections = [];
    for (let i = 0; i < maxSongs; i++) {
        const selectedCandidate = selectRandomly();
        if (!selectedCandidate) continue;
        selections.push(selectedCandidate);
        totalAdjustedWeight -= selectedCandidate.adjustedWeight;
        candidatesArray.splice(candidatesArray.indexOf(selectedCandidate), 1);
    }
    return selections;
}

function penalizeDuplicateRomajiNames(selectedTracks, reviewCandidates) {
    console.log(`penalizeDuplicateRomajiNames started with ${selectedTracks.length} tracks`);

    const MAX_ITERATIONS = 1000;
    let iterations = 0;
    let index = 0;
    let totalReplacements = 0;

    while (index < selectedTracks.length && iterations < MAX_ITERATIONS) {
        iterations++;
        let duplicateIndexes = [];

        for (let i = index + 1; i < selectedTracks.length; i++) {
            if (selectedTracks[index] && selectedTracks[i] && songList[selectedTracks[index].key] && songList[selectedTracks[i].key] && songList[selectedTracks[index].key].animeRomajiName === songList[selectedTracks[i].key].animeRomajiName) {
                if (i - index <= 7) {
                    duplicateIndexes.push(i);
                }
            }
        }

        console.log(`Iteration ${iterations}: Found ${duplicateIndexes.length} duplicates at index ${index}`);

        while (duplicateIndexes.length > 0 && selectedTracks.length > 1) {
            let randomChance = Math.random() * 10;
            if (randomChance >= 3) {
                let dupeIndex = duplicateIndexes.pop();
                let duplicateTrack = selectedTracks[dupeIndex];
                selectedTracks.splice(dupeIndex, 1);

                let newTrack;
                let attempts = 0;
                do {
                    attempts++;
                    let selectionResult = weightedRandomSelection(reviewCandidates, 1);
                    newTrack = selectionResult[0];
                } while (newTrack && songList[newTrack.key] && selectedTracks.some((track) => track && songList[track.key] && songList[track.key].animeRomajiName === songList[newTrack.key].animeRomajiName) && attempts < 100);

                if (attempts < 100 && newTrack && songList[newTrack.key]) {
                    selectedTracks.splice(dupeIndex, 0, newTrack);
                    totalReplacements++;
                    console.log(`Replaced duplicate at index ${dupeIndex} after ${attempts} attempts:`);
                    console.log(`  Removed: "${songList[duplicateTrack.key].animeRomajiName}" (${songList[duplicateTrack.key].songName} by ${songList[duplicateTrack.key].songArtist})`);
                    console.log(`  Added:   "${songList[newTrack.key].animeRomajiName}" (${songList[newTrack.key].songName} by ${songList[newTrack.key].songArtist})`);
                } else {
                    console.log(`Failed to find non-duplicate replacement after 100 attempts for:`);
                    console.log(`  "${songList[duplicateTrack.key].animeRomajiName}" (${songList[duplicateTrack.key].songName} by ${songList[duplicateTrack.key].songArtist})`);
                }
            } else {
                let skippedIndex = duplicateIndexes.pop();
                console.log(`Skipped replacement due to random chance for duplicate at index ${skippedIndex}:`);
                console.log(`  "${songList[selectedTracks[skippedIndex].key].animeRomajiName}" (${songList[selectedTracks[skippedIndex].key].songName} by ${songList[selectedTracks[skippedIndex].key].songArtist})`);
            }
        }

        if (duplicateIndexes.length === 0) {
            index++;
        }
    }

    if (iterations >= MAX_ITERATIONS) {
        console.warn(`penalizeDuplicateRomajiNames reached maximum iterations (${MAX_ITERATIONS})`);
    }

    console.log(`penalizeDuplicateRomajiNames completed after ${iterations} iterations`);
    console.log(`Total replacements made: ${totalReplacements}`);
    console.log(`Final track count: ${selectedTracks.length}`);

    // Remove any undefined or invalid tracks
    selectedTracks = selectedTracks.filter((track) => track && songList[track.key]);

    return selectedTracks;
}

function penalizeAndAdjustSelection(selectedCandidates, reviewCandidates, maxSongs) {
    let adjustedSelection = [...selectedCandidates];
    let remainingCandidates = reviewCandidates.filter((c) => !selectedCandidates.includes(c));

    // Separate new songs and regular songs
    let newSongs = adjustedSelection.filter((c) => c.weight === 9999);
    let regularSongs = adjustedSelection.filter((c) => c.weight !== 9999);

    penalizeDuplicateRomajiNames(regularSongs, remainingCandidates);

    // If we removed any regular songs during penalization, try to replace them with other regular songs
    let regularSongsNeeded = Math.min(Math.floor(maxSongs / 2), selectedCandidates.filter((c) => c.weight !== 9999).length) - regularSongs.length;
    let availableRegularSongs = remainingCandidates.filter((c) => c.weight !== 9999);

    while (regularSongsNeeded > 0 && availableRegularSongs.length > 0) {
        let randomRegularSong = weightedRandomSelection(availableRegularSongs, 1)[0];
        regularSongs.push(randomRegularSong);
        availableRegularSongs = availableRegularSongs.filter((c) => c !== randomRegularSong);
        regularSongsNeeded--;
    }

    // Combine new songs and regular songs
    adjustedSelection = [...newSongs, ...regularSongs];

    return adjustedSelection.slice(0, maxSongs);
}

function addWeightAdjustmentButtons() {
    if (!quiz.cslActive || !isTraining || buttonContainerAdded) return;

    // Create the container for weight adjustment buttons
    const $weightAdjustmentContainer = $(`
		<div id="qpWeightAdjustmentContainer" class="container-fluid">
			<div class="row">
				<div class="col-xs-12">
					<h5 class="text-center" style="margin-bottom: 8px; color: #f2f2f2; font-size: 14px;">Song Appearance Rate</h5>
				</div>
			</div>
			<div class="row">
				<div class="col-xs-5 text-right" style="padding-right: 5px;">
					<button id="qpWeightBoostButton" class="btn btn-sm" style="width: 100%;">
						<i class="fa fa-chevron-up" aria-hidden="true"></i> Boost
					</button>
				</div>
				<div class="col-xs-2 text-center" style="padding-left: 2px; padding-right: 2px;">
					<button id="qpWeightResetButton" class="btn btn-sm" style="width: 100%;">
						<i class="fa fa-refresh" aria-hidden="true"></i>
					</button>
				</div>
				<div class="col-xs-5 text-left" style="padding-left: 5px;">
					<button id="qpWeightLowerButton" class="btn btn-sm" style="width: 100%;">
						<i class="fa fa-chevron-down" aria-hidden="true"></i> Lower
					</button>
				</div>
			</div>
			<div class="row" style="margin-top: 5px;">
				<div class="col-xs-12">
					<button id="qpWeightRevertButton" class="btn btn-info btn-sm" style="width: 100%;">
						Revert
					</button>
				</div>
			</div>
		</div>
      `);

    // Add click handlers
    $weightAdjustmentContainer.find("#qpWeightBoostButton").click(() => adjustWeightOnUserInteraction(1.5));
    $weightAdjustmentContainer.find("#qpWeightResetButton").click(() => adjustWeightOnUserInteraction(1));
    $weightAdjustmentContainer.find("#qpWeightLowerButton").click(() => adjustWeightOnUserInteraction(0.5));
    $weightAdjustmentContainer.find("#qpWeightRevertButton").click(() => revertWeight());

    // Insert the container after qpSongInfoContainer
    $weightAdjustmentContainer.insertAfter("#qpSongInfoContainer");
    buttonContainerAdded = true;

    // Add some custom CSS
    $("<style>")
        .prop("type", "text/css")
        .html(
            `
      #qpWeightAdjustmentContainer {
          background-color: rgba(0, 0, 0, 0.3);
          border-radius: 5px;
          padding: 4px;
          margin-top: 4px;
          margin-bottom: 4px;
          max-width: 280px;
          margin-left: auto;
          margin-right: auto;
          width: 21rem;
      }
      #qpWeightAdjustmentContainer .btn {
          transition: all 0.3s ease;
          opacity: 0.7;
          padding: 3px 6px;
          font-size: 12px;
      }
      #qpWeightAdjustmentContainer .btn:hover {
          transform: scale(1.05);
          opacity: 1;
      }
      #qpWeightLowerButton {
          background-color: rgba(70, 70, 70, 0.7);
          border-color: rgba(50, 50, 50, 0.7);
      }
      #qpWeightBoostButton {
          background-color: rgba(100, 100, 100, 0.7);
          border-color: rgba(80, 80, 80, 0.7);
      }
      #qpWeightResetButton {
          background-color: rgba(85, 85, 85, 0.7);
          border-color: rgba(65, 65, 65, 0.7);
      }
        #qpWeightRevertButton {
          background-color: rgba(85, 85, 85, 0.7);
          border-color: rgba(65, 65, 65, 0.7);
      }
      #qpWeightLowerButton:hover {
          background-color: rgba(60, 60, 60, 0.8);
          border-color: rgba(40, 40, 40, 0.8);
      }
      #qpWeightBoostButton:hover {
          background-color: rgba(110, 110, 110, 0.8);
          border-color: rgba(90, 90, 90, 0.8);
      }
      #qpWeightResetButton:hover {
          background-color: rgba(95, 95, 95, 0.8);
          border-color: rgba(75, 75, 75, 0.8);
      }
        #qpWeightRevertButton:hover {
          background-color: rgba(95, 95, 95, 0.8);
          border-color: rgba(75, 75, 75, 0.8);
      }

      #cslSettingsResetMaxNewSongs {
          background-color: rgba(100, 100, 100, 0.7);
          border-color: rgba(80, 80, 80, 0.7);
      }

        #cslSettingsResetMaxNewSongs:hover {
          background-color: rgba(110, 110, 110, 0.8);
          border-color: rgba(90, 90, 90, 0.8);
      }
      `
        )
        .appendTo("head");
}

function adjustWeightOnUserInteraction(factor) {
    if (!quiz.cslActive || !isTraining) return;

    const currentSongNumber = document.querySelector("#qpCurrentSongCount").textContent;
    const currentSongListIndex = songOrder[currentSongNumber];

    if (currentSongListIndex === undefined) {
        console.error("Current song index not found in songOrder");
        return;
    }

    const currentSongData = mySongList[currentSongListIndex];

    if (!currentSongData) {
        console.error("Current song data not found");
        return;
    }

    const songKey = `${currentSongData.songArtist}_${currentSongData.songName}`;

    // Store the current song key
    if (songKey !== currentSongKey) {
        currentSongKey = songKey;
        originalWeight = null;
    }

    let reviewData = loadReviewData();
    if (reviewData[songKey]) {
        // Store the original weight if it hasn't been stored yet
        if (originalWeight === null) {
            originalWeight = reviewData[songKey].weight;
        }

        const previousWeight = reviewData[songKey].weight || "error";

        reviewData[songKey].manualWeightAdjustment = factor;
        reviewData[songKey].weight = calculateWeight(false, reviewData[songKey]);

        const newWeight = reviewData[songKey].weight;
        console.log(previousWeight, factor, newWeight);

        saveReviewData(reviewData);

        const actionWord = factor > 1 ? "increased" : "decreased";
        gameChat.systemMessage(`Song weight ${actionWord} for "${currentSongData.songName}"`);
        console.log(`Song weight ${actionWord} for "${currentSongData.songName}" New: ${newWeight.toFixed(2)} | Old: ${previousWeight.toFixed(2)}`,reviewData[songKey])
    } else {
        console.error("Review data not found for song:", songKey);
    }
}

function revertWeight() {
    if (!isTraining || !previousAttemptData) {
        console.log("Cannot revert weight: No previous attempt data available or not in training mode.");
        return;
    }

    let reviewData = loadReviewData();
    const songKey = previousAttemptData.songKey;

    if (reviewData[songKey]) {
        const oldWeight = reviewData[songKey].weight;
        const newWeight = previousAttemptData.weight;

        // Restore the previous state
        reviewData[songKey] = { ...previousAttemptData };
        delete reviewData[songKey].songKey; // Remove the extra songKey we added

        saveReviewData(reviewData);

        const currentSongNumber = document.querySelector("#qpCurrentSongCount").textContent;
        const currentSongListIndex = songOrder[currentSongNumber];
        const currentSongData = finalSongList[currentSongListIndex];

        gameChat.systemMessage(`Song weight reverted for "${currentSongData.songName}"`);
        console.log(`Song weight reverted for "${currentSongData.songName}". Old: ${oldWeight.toFixed(2)} | New: ${newWeight.toFixed(2)}`, reviewData[songKey]);

        // Clear the previousAttemptData after reverting
        previousAttemptData = null;
    } else {
        console.error("Review data not found for song:", songKey);
    }
}

let usedNewSongs = new Set(); // Global variable to track used new songs across game sessions

function resetNewSongsCount() {
    newSongsAdded24Hours = 0;
    lastResetTime = Date.now();
    saveNewSongsSettings();
}

function prepareSongForTraining(songKeys, maxSongs) {
    console.log(`=== prepareSongForTraining START ===`);
    console.log(`Input: ${songKeys.length} tracks, maxSongs: ${maxSongs}`);
    console.log(`Current Profile: ${currentProfile}`);

    loadNewSongsSettings();
    console.log(`Loaded settings: maxNewSongs24Hours = ${maxNewSongs24Hours}, newSongsAdded24Hours = ${newSongsAdded24Hours}, incorrectSongsPerGame = ${incorrectSongsPerGame}, correctSongsPerGame = ${correctSongsPerGame}`);

    // Check if 24 hours have passed since the last reset
    if (Date.now() - lastResetTime > 24 * 60 * 60 * 1000) {
        console.log("24 hours have passed. Resetting new songs count.");
        resetNewSongsCount();
        console.log(`After reset: newSongsAdded24Hours = ${newSongsAdded24Hours}, lastResetTime = ${new Date(lastResetTime)}`);
    }

    let repeatMode = $("#cslgSettingsRepeatModeSwitch").prop("checked");
    let repeatModeRange = $("#cslgSettingsRepeatMode").slider("getValue");

    console.log(`Repeat Mode: ${repeatMode ? "Enabled" : "Disabled"}`);
    if (repeatMode) {
        console.log(`Repeat Mode Range: ${repeatModeRange[0]} - ${repeatModeRange[1]}`);
        gameChat.systemMessage("Warning: Repeat Mode is enabled. Max New Songs, Incorrect Songs per Game, and Correct Songs per Game settings are ignored.");
    }

    console.log(`Creating review candidates...`);
    let reviewCandidates = songKeys.map((song) => {
        let reviewState = getReviewState(song);
        return {
            ...reviewState,
            song: song,
        };
    });
    console.log(`Created ${reviewCandidates.length} review candidates`);

    if (repeatMode) {
        console.log(`Applying Repeat Mode filtering...`);
        reviewCandidates = reviewCandidates.filter((candidate) => {
            let passes = candidate.reviewState.efactor >= repeatModeRange[0] &&
                         candidate.reviewState.efactor <= repeatModeRange[1] &&
                         candidate.reviewState.weight !== 9999;
            if (passes) {
                console.log(`Candidate passed: ${candidate.song.songName} (E-Factor: ${candidate.reviewState.efactor}, Weight: ${candidate.reviewState.weight})`);
            }
            return passes;
        });
        console.log(`After Repeat Mode filtering: ${reviewCandidates.length} candidates`);
        reviewCandidates = shuffleArray(reviewCandidates).slice(0, maxSongs);
        console.log(`After shuffle and slice: ${reviewCandidates.length} candidates`);
    } else {
        console.log(`Normal mode selection...`);
        let incorrectSongs = reviewCandidates.filter((candidate) => candidate.reviewState.isLastTryCorrect === false);
        let newSongs = reviewCandidates.filter((candidate) => candidate.reviewState.weight === 9999);
        let correctSongs = reviewCandidates.filter((candidate) => candidate.reviewState.isLastTryCorrect === true);
        let regularSongs = reviewCandidates.filter((candidate) => candidate.reviewState.weight !== 9999 && candidate.reviewState.isLastTryCorrect === undefined);

        console.log(`Initial counts: ${incorrectSongs.length} incorrect, ${newSongs.length} new, ${correctSongs.length} correct, ${regularSongs.length} regular`);

        incorrectSongs = shuffleArray(incorrectSongs);
        newSongs = shuffleArray(newSongs);
        correctSongs = shuffleArray(correctSongs);
        regularSongs = shuffleArray(regularSongs);

        console.log(`Combining priority songs...`);
        let prioritySongs = shuffleArray([...incorrectSongs.slice(0, incorrectSongsPerGame), ...newSongs, ...correctSongs.slice(0, correctSongsPerGame)]);
        console.log(`Priority songs: ${prioritySongs.length}`);

        let maxPrioritySongsToAdd = Math.min(prioritySongs.length, maxSongs, incorrectSongsPerGame + correctSongsPerGame + (maxNewSongs24Hours - newSongsAdded24Hours));
        console.log(`Max priority songs to add: ${maxPrioritySongsToAdd}`);

        let selectedPrioritySongs = prioritySongs.slice(0, maxPrioritySongsToAdd);
        console.log(`Selected priority songs: ${selectedPrioritySongs.length}`);

        let maxRegularSongsToAdd = maxSongs - selectedPrioritySongs.length;
        console.log(`Max regular songs to add: ${maxRegularSongsToAdd}`);

        let selectedRegularSongs = regularSongs.slice(0, maxRegularSongsToAdd);
        console.log(`Selected regular songs: ${selectedRegularSongs.length}`);

        reviewCandidates = [...selectedPrioritySongs, ...selectedRegularSongs];
        console.log(`Total selected candidates: ${reviewCandidates.length}`);
    }

    console.log(`Adding potential new songs...`);
    let potentialNewSongsCount = 0;
    reviewCandidates.forEach((candidate) => {
        if (candidate.reviewState.weight === 9999) {
            potentialNewSongs.add(`${candidate.song.songArtist}_${candidate.song.songName}`);
            potentialNewSongsCount++;
        }
        console.log("candidate", candidate);
    });
    console.log(`Added ${potentialNewSongsCount} potential new songs`);

    if (reviewCandidates.length < maxSongs) {
        console.warn(`Warning: Only ${reviewCandidates.length} songs selected out of ${maxSongs} requested. There may not be enough songs in the specified categories or difficulty range.`);
    }

    let finalIncorrectSongs = reviewCandidates.filter((candidate) => candidate.reviewState.isLastTryCorrect === false);
    let finalNewSongs = reviewCandidates.filter((candidate) => candidate.reviewState.weight === 9999);
    let finalCorrectSongs = reviewCandidates.filter((candidate) => candidate.reviewState.isLastTryCorrect === true);
    let finalRegularSongs = reviewCandidates.filter((candidate) => candidate.reviewState.weight !== 9999 && candidate.reviewState.isLastTryCorrect === undefined);

    console.log(`Final selection breakdown:`);
    console.log(`- Incorrect songs: ${finalIncorrectSongs.length}`);
    console.log(`- Potential new songs: ${finalNewSongs.length}`);
    console.log(`- Correct songs: ${finalCorrectSongs.length}`);
    console.log(`- Regular songs: ${finalRegularSongs.length}`);

    let finalSelection = shuffleArray(reviewCandidates).map((candidate) => candidate.song);

    console.log(`Final selection songs:`);
    finalSelection.forEach((song, index) => {
        console.log(`${index + 1}. "${song.songName}" by ${song.songArtist} (Anime: ${song.animeRomajiName})`);
    });

    console.log(`=== prepareSongForTraining END ===`);
    return finalSelection;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function resetUsedNewSongs() {
    usedNewSongs.clear();
}

// setup
function setup() {
    initializeSettingsContainer();
    loadIgnoredSongs();
    new Listener("New Player", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
            let player = Object.values(quiz.players).find((p) => p._name === payload.name);
            if (player) {
                sendSystemMessage(`CSL: reconnecting ${payload.name}`);
                cslMessage("§CSL0" + btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? "1" : "0"}`));
            } else {
                cslMessage(`CSL game in progress, removing ${payload.name}`);
                lobby.changeToSpectator(payload.name);
            }
        }
    }).bindListener();
    new Listener("New Spectator", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
            let player = Object.values(quiz.players).find((p) => p._name === payload.name);
            if (player) {
                sendSystemMessage(`CSL: reconnecting ${payload.name}`);
                cslMessage("§CSL17" + btoa(payload.name));
            } else {
                cslMessage("§CSL0" + btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? "1" : "0"}`));
            }
            setTimeout(() => {
                let song = songList[songOrder[currentSong]];
                let message = `${currentSong}§${getStartPoint()}§${song.audio || ""}§${song.video480 || ""}§${song.video720 || ""}`;
                splitIntoChunks(btoa(message) + "$", 144).forEach((item, index) => {
                    cslMessage("§CSL3" + base10to36(index % 36) + item);
                });
            }, 300);
        }
    }).bindListener();
    new Listener("Spectator Change To Player", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
            let player = Object.values(quiz.players).find((p) => p._name === payload.name);
            if (player) {
                cslMessage("§CSL0" + btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? "1" : "0"}`));
            } else {
                cslMessage(`CSL game in progress, removing ${payload.name}`);
                lobby.changeToSpectator(payload.name);
            }
        }
    }).bindListener();
    new Listener("Player Change To Spectator", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
            let player = Object.values(quiz.players).find((p) => p._name === payload.name);
            if (player) {
                cslMessage("§CSL17" + btoa(payload.name));
            } else {
                cslMessage("§CSL0" + btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? "1" : "0"}`));
            }
        }
    }).bindListener();
    new Listener("Host Promotion", (payload) => {
        if (quiz.cslActive && quiz.inQuiz) {
            sendSystemMessage("CSL host changed, ending quiz");
            quizOver();
        }
    }).bindListener();
    new Listener("Player Left", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && payload.player.name === cslMultiplayer.host) {
            sendSystemMessage("CSL host left, ending quiz");
            quizOver();
        }
    }).bindListener();
    new Listener("Spectator Left", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && payload.spectator === cslMultiplayer.host) {
            sendSystemMessage("CSL host left, ending quiz");
            quizOver();
        }
    }).bindListener();
    new Listener("game closed", (payload) => {
        if (quiz.cslActive && quiz.inQuiz) {
            reset();
            messageDisplayer.displayMessage("Room Closed", payload.reason);
            lobby.leave({ supressServerMsg: true });
        }
    }).bindListener();
    new Listener("game chat update", (payload) => {
        for (let message of payload.messages) {
            if (message.message.startsWith("§CSL")) {
                if (!showCSLMessages) {
                    setTimeout(() => {
                        let $message = gameChat.$chatMessageContainer.find(".gcMessage").last();
                        if ($message.text().startsWith("§CSL")) $message.parent().remove();
                    }, 0);
                }
                parseMessage(message.message, message.sender);
            } else if (debug && message.sender === selfName && message.message.startsWith("/csl")) {
                try {
                    cslMessage(JSON.stringify(eval(message.message.slice(5))));
                } catch {
                    cslMessage("ERROR");
                }
            }
        }
    }).bindListener();
    new Listener("Game Chat Message", (payload) => {
        if (payload.message.startsWith("§CSL")) {
            parseMessage(message.message, message.sender);
        }
    }).bindListener();
    new Listener("Game Starting", (payload) => {
        clearTimeEvents();
    }).bindListener();
    new Listener("Join Game", (payload) => {
        reset();
    }).bindListener();
    new Listener("Spectate Game", (payload) => {
        reset();
    }).bindListener();
    new Listener("Host Game", (payload) => {
        reset();
        $("#cslgSettingsModal").modal("hide");
    }).bindListener();
    new Listener("get all song names", () => {
        setTimeout(() => {
            let list = quiz.answerInput.typingInput.autoCompleteController.list;
            if (list.length) {
                autocomplete = list.map((x) => x.toLowerCase());
                autocompleteInput = new AmqAwesomeplete(document.querySelector("#cslgNewAnswerInput"), { list: list }, true);
            }
        }, 10);
    }).bindListener();
    new Listener("update all song names", () => {
        setTimeout(() => {
            let list = quiz.answerInput.typingInput.autoCompleteController.list;
            if (list.length) {
                autocomplete = list.map((x) => x.toLowerCase());
                autocompleteInput.list = list;
            }
        }, 10);
    }).bindListener();

    quiz.pauseButton.$button.off("click").click(() => {
        if (quiz.cslActive) {
            if (quiz.soloMode) {
                if (quiz.pauseButton.pauseOn) {
                    fireListener("quiz unpause triggered", {
                        playerName: selfName,
                    });
                    /*fireListener("quiz unpause triggered", {
                        "playerName": selfName,
                        "doCountDown": true,
                        "countDownLength": 3000
                    });*/
                } else {
                    fireListener("quiz pause triggered", {
                        playerName: selfName,
                    });
                }
            } else {
                if (quiz.pauseButton.pauseOn) {
                    cslMessage("§CSL12");
                } else {
                    cslMessage("§CSL11");
                }
            }
        } else {
            socket.sendCommand({ type: "quiz", command: quiz.pauseButton.pauseOn ? "quiz unpause" : "quiz pause" });
        }
    });

    const oldSendSkipVote = quiz.skipController.sendSkipVote;
    quiz.skipController.sendSkipVote = function () {
        if (quiz.cslActive) {
            if (quiz.soloMode) {
                clearTimeout(this.autoVoteTimeout);
            } else if (!skipping) {
                cslMessage("§CSL14");
            }
        } else {
            oldSendSkipVote.apply(this, arguments);
        }
    };

    const oldLeave = quiz.leave;
    quiz.leave = function () {
        reset();
        oldLeave.apply(this, arguments);
    };

    const oldStartReturnLobbyVote = quiz.startReturnLobbyVote;
    quiz.startReturnLobbyVote = function () {
        if (quiz.cslActive && quiz.inQuiz) {
            if (quiz.soloMode) {
                quizOver();
            } else if (quiz.isHost) {
                cslMessage("§CSL10");
            }
        } else {
            oldStartReturnLobbyVote.apply(this, arguments);
        }
    };

    const oldSubmitAnswer = QuizTypeAnswerInputController.prototype.submitAnswer;
    QuizTypeAnswerInputController.prototype.submitAnswer = function (answer) {
        if (quiz.cslActive) {
            currentAnswers[quiz.ownGamePlayerId] = answer;
            this.skipController.highlight = true;
            fireListener("quiz answer", {
                answer: answer,
                success: true,
            });
            if (quiz.soloMode) {
                fireListener("player answered", [0]);
                if (options.autoVoteSkipGuess) {
                    this.skipController.voteSkip();
                    fireListener("quiz overlay message", "Skipping to Answers");
                }
            } else {
                cslMessage("§CSL13");
                if (options.autoVoteSkipGuess) {
                    this.skipController.voteSkip();
                }
            }
        } else {
            oldSubmitAnswer.apply(this, arguments);
        }
    };

    const oldVideoReady = quiz.videoReady;
    quiz.videoReady = function (songId) {
        if (quiz.cslActive && this.inQuiz) {
            nextVideoReady = true;
        } else {
            oldVideoReady.apply(this, arguments);
        }
    };

    const oldHandleError = MoeVideoPlayer.prototype.handleError;
    MoeVideoPlayer.prototype.handleError = function () {
        if (quiz.cslActive) {
            gameChat.systemMessage(`CSL Error: couldn't load song ${currentSong + 1}`);
            nextVideoReady = true;
        } else {
            oldHandleError.apply(this, arguments);
        }
    };

    document.body.addEventListener("keydown", (event) => {
        const key = event.key;
        const altKey = event.altKey;
        const ctrlKey = event.ctrlKey;
        if (testHotkey("start", key, altKey, ctrlKey)) {
            validateStart();
        }
        if (testHotkey("stop", key, altKey, ctrlKey)) {
            quizOver();
        }

        if (testHotkey("startTraining", key, altKey, ctrlKey)) {
            validateTrainingStart();
        }
        if (testHotkey("stopTraining", key, altKey, ctrlKey)) {
            quizOver();
        }

        if (testHotkey("cslgWindow", key, altKey, ctrlKey)) {
            if ($("#cslgSettingsModal").is(":visible")) {
                $("#cslgSettingsModal").modal("hide");
            } else {
                openSettingsModal();
            }
        }
        /*if (testHotkey("mergeAll", key, altKey, ctrlKey)) {
            mergedSongList = Array.from(new Set(mergedSongList.concat(songList).map((x) => JSON.stringify(x)))).map((x) => JSON.parse(x));
            createMergedSongListTable();
        }*/
    });

    resultChunk = new Chunk();
    songInfoChunk = new Chunk();
    nextSongChunk = new Chunk();

    AMQ_addScriptData({
        name: "Custom Song List Game",
        author: "kempanator",
        version: version,
        link: "https://github.com/kempanator/amq-scripts/raw/main/amqCustomSongListGame.user.js",
        description: `
            </ul><b>How to start a custom song list game:</b>
                <li>create a solo lobby</li>
                <li>click the CSL button in the top right</li>
                <li>click the autocomplete button if it is red</li>
                <li>create or upload a list in the song list tab</li>
                <li>change settings in the settings tab</li>
                <li>fix any invalid answers in the answer tab</li>
                <li>click start to play the quiz</li>
            </ul>
        `,
    });
    applyStyles();
}

// validate all settings and attempt to start csl quiz
function validateStart() {
    isTraining = false;
    if (!lobby.inLobby) return;
    songOrder = {};
    if (!lobby.isHost) {
        return messageDisplayer.displayMessage("Unable to start", "must be host");
    }
    if (lobby.numberOfPlayers !== lobby.numberOfPlayersReady) {
        return messageDisplayer.displayMessage("Unable to start", "all players must be ready");
    }
    if (!mySongList || !mySongList.length) {
        return messageDisplayer.displayMessage("Unable to start", "no songs in My Songs list");
    }
    if (autocomplete.length === 0) {
        return messageDisplayer.displayMessage("Unable to start", "autocomplete list empty");
    }
    let numSongs = getSliderValue("#cslgSettingsSongs", "#cslgSettingsSongsInput");
    if (isNaN(numSongs) || numSongs < 1) {
        return messageDisplayer.displayMessage("Unable to start", "invalid number of songs");
    }
    guessTime = getSliderValue("#cslgSettingsGuessTime", "#cslgSettingsGuessTimeInput");
    if (isNaN(guessTime) || guessTime < 1 || guessTime > 99) {
        return messageDisplayer.displayMessage("Unable to start", "invalid guess time");
    }
    extraGuessTime = getSliderValue("#cslgSettingsExtraGuessTime", "#cslgSettingsExtraGuessTimeInput");
    if (isNaN(extraGuessTime) || extraGuessTime < 0 || extraGuessTime > 15) {
        return messageDisplayer.displayMessage("Unable to start", "invalid extra guess time");
    }
    startPointRange = $("#cslgSettingsStartPoint").slider("getValue");
    if (startPointRange[0] < 0 || startPointRange[0] > 100 || startPointRange[1] < 0 || startPointRange[1] > 100 || startPointRange[0] > startPointRange[1]) {
        return messageDisplayer.displayMessage("Unable to start", "song start sample must be a range 0-100");
    }
    difficultyRange = $("#cslgSettingsDifficulty").slider("getValue");
    if (difficultyRange[0] < 0 || difficultyRange[0] > 100 || difficultyRange[1] < 0 || difficultyRange[1] > 100 || difficultyRange[0] > difficultyRange[1]) {
        return messageDisplayer.displayMessage("Unable to start", "difficulty must be a range 0-100");
    }
    let ops = $("#cslgSettingsOPCheckbox").prop("checked");
    let eds = $("#cslgSettingsEDCheckbox").prop("checked");
    let ins = $("#cslgSettingsINCheckbox").prop("checked");
    let tv = $("#cslgSettingsTVCheckbox").prop("checked");
    let movie = $("#cslgSettingsMovieCheckbox").prop("checked");
    let ova = $("#cslgSettingsOVACheckbox").prop("checked");
    let ona = $("#cslgSettingsONACheckbox").prop("checked");
    let special = $("#cslgSettingsSpecialCheckbox").prop("checked");

    let filteredSongs = mySongList.filter((song) => {
        // Type check for song.songType (can be either string or number)
        let passesTypeFilter = false;
        if (typeof song.songType === 'number') {
            // Handle as a number (assuming 1 = Opening, 2 = Ending, 3 = Insert)
            passesTypeFilter = (ops && song.songType === 1) ||
                (eds && song.songType === 2) ||
                (ins && song.songType === 3);
        } else if (typeof song.songType === 'string') {
            // Handle as a string (check if it contains "Opening", "Ending", or "Insert")
            let songType = String(song.songType);  // Ensure it's a string
            passesTypeFilter = (ops && songType.includes("Opening")) ||
                (eds && songType.includes("Ending")) ||
                (ins && songType.includes("Insert"));
        } else {
            console.log("Unknown songType format:", song.songType);
        }
        let passesAnimeTypeFilter = (tv && song.animeType === "TV") || (movie && song.animeType === "Movie") || (ova && song.animeType === "OVA") || (ona && song.animeType === "ONA") || (special && song.animeType === "Special");
        return passesTypeFilter && passesAnimeTypeFilter && difficultyFilter(song, difficultyRange[0], difficultyRange[1]);
    });

    if (filteredSongs.length === 0) {
        return messageDisplayer.displayMessage("Unable to start", "0 songs match the specified criteria");
    }

    if (songOrderType === "random") {
        shuffleArray(filteredSongs);
    } else if (songOrderType === "descending") {
        filteredSongs.reverse();
    }

    filteredSongs.slice(0, numSongs).forEach((song, i) => {
        songOrder[i + 1] = mySongList.indexOf(song); // Store the index in mySongList
    });

    totalSongs = Object.keys(songOrder).length;
    if (totalSongs === 0) {
        return messageDisplayer.displayMessage("Unable to start", "no songs match the specified criteria");
    }
    fastSkip = $("#cslgSettingsFastSkip").prop("checked");
    $("#cslgSettingsModal").modal("hide");
    console.log("song order: ", songOrder);
    if (lobby.soloMode) {
        startQuiz(filteredSongs);
    } else if (lobby.isHost) {
        cslMessage("§CSL0" + btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? "1" : "0"}`));
    }
}

// start quiz and load first song
function startQuiz() {
    if (!lobby.inLobby) return;
    if (lobby.soloMode) {
        if (mySongList.length){
            finalSongList = mySongList;
        }
        else if (songList.length){
            finalSongList = songList;
        }
        else{
            return;
        }
    } else {
        cslMultiplayer.host = lobby.hostName;
    }
    let song;
    if (lobby.isHost) {
        song = finalSongList[songOrder[1]];
    }
    skipping = false;
    quiz.cslActive = true;
    addWeightAdjustmentButtons();
    let date = new Date().toISOString();
    for (let player of Object.values(lobby.players)) {
        score[player.gamePlayerId] = 0;
    }
    //console.log({showSelection, totalSongs, guessTime, extraGuessTime, fastSkip});
    let data = {
        gameMode: lobby.soloMode ? "Solo" : "Multiplayer",
        showSelection: showSelection,
        groupSlotMap: createGroupSlotMap(Object.keys(lobby.players)),
        players: [],
        multipleChoice: false,
        quizDescription: {
            quizId: "",
            startTime: date,
            roomName: hostModal.$roomName.val(),
        },
    };
    Object.values(lobby.players).forEach((player, i) => {
        player.pose = 1;
        player.sore = 0;
        player.position = Math.floor(i / 8) + 1;
        player.positionSlot = i % 8;
        player.teamCaptain = null;
        player.teamNumber = null;
        player.teamPlayer = null;
        data.players.push(player);
    });
    //console.log(data.players);
    fireListener("Game Starting", data);
    setTimeout(() => {
        if (quiz.soloMode) {
            fireListener("quiz next video info", {
                playLength: guessTime,
                playbackSpeed: 1,
                startPont: getStartPoint(),
                videoInfo: {
                    id: null,
                    videoMap: {
                        catbox: createCatboxLinkObject(song.audio, song.video480, song.video720),
                    },
                    videoVolumeMap: {
                        catbox: {
                            0: -20,
                            480: -20,
                            720: -20,
                        },
                    },
                },
            });
        } else {
            if (quiz.isHost) {
                let message = `1§${getStartPoint()}§${song.audio || ""}§${song.video480 || ""}§${song.video720 || ""}`;
                splitIntoChunks(btoa(encodeURIComponent(message)) + "$", 144).forEach((item, index) => {
                    cslMessage("§CSL3" + base10to36(index % 36) + item);
                });
            }
        }
    }, 100);
    if (quiz.soloMode) {
        setTimeout(() => {
            fireListener("quiz ready", {
                numberOfSongs: totalSongs,
            });
        }, 200);
        setTimeout(() => {
            fireListener("quiz waiting buffering", {
                firstSong: true,
            });
        }, 300);
        setTimeout(() => {
            previousSongFinished = true;
            readySong(1);
        }, 400);
    }
}

// check if all conditions are met to go to next song
function readySong(songNumber) {
    if (songNumber === currentSong) return;
    //console.log("Ready song: " + songNumber);
    nextVideoReadyInterval = setInterval(() => {
        //console.log({nextVideoReady, previousSongFinished});
        if (nextVideoReady && !quiz.pauseButton.pauseOn && previousSongFinished) {
            clearInterval(nextVideoReadyInterval);
            nextVideoReady = false;
            previousSongFinished = false;
            if (quiz.soloMode) {
                playSong(songNumber);
            } else if (quiz.isHost) {
                cslMessage("§CSL4" + btoa(songNumber));
            }
        }
    }, 100);
}

// play a song
function playSong(songNumber) {
    if (!quiz.cslActive || !quiz.inQuiz) return reset();
    for (let key of Object.keys(quiz.players)) {
        currentAnswers[key] = "";
        cslMultiplayer.voteSkip[key] = false;
    }
    answerChunks = {};
    resultChunk = new Chunk();
    songInfoChunk = new Chunk();
    cslMultiplayer.songInfo = {};
    currentSong = songNumber;
    cslState = 1;
    skipping = false;
    fireListener("play next song", {
        time: guessTime,
        extraGuessTime: extraGuessTime,
        songNumber: songNumber,
        progressBarState: { length: guessTime, played: 0 },
        onLastSong: songNumber === totalSongs,
        multipleChoiceNames: null,
    });
    if (extraGuessTime) {
        extraGuessTimer = setTimeout(() => {
            fireListener("extra guess time");
        }, guessTime * 1000);
    }
    endGuessTimer = setTimeout(() => {
        if (quiz.soloMode) {
            clearInterval(skipInterval);
            clearTimeout(endGuessTimer);
            clearTimeout(extraGuessTimer);
            endGuessPhase(songNumber);
        } else if (quiz.isHost) {
            cslMessage("§CSL15");
        }
    }, (guessTime + extraGuessTime) * 1000);
    if (quiz.soloMode) {
        skipInterval = setInterval(() => {
            if (quiz.skipController._toggled) {
                fireListener("quiz overlay message", "Skipping to Answers");
                clearInterval(skipInterval);
                clearTimeout(endGuessTimer);
                clearTimeout(extraGuessTimer);
                setTimeout(
                    () => {
                        endGuessPhase(songNumber);
                    },
                    fastSkip ? 1000 : 3000
                );
            }
        }, 100);
    }
    setTimeout(() => {
        if (songNumber < totalSongs) {
            if (quiz.soloMode) {
                readySong(songNumber + 1);
                let nextSong = finalSongList[songOrder[songNumber + 1]];
                fireListener("quiz next video info", {
                    playLength: guessTime,
                    playbackSpeed: 1,
                    startPont: getStartPoint(),
                    videoInfo: {
                        id: null,
                        videoMap: {
                            catbox: createCatboxLinkObject(nextSong.audio, nextSong.video480, nextSong.video720),
                        },
                        videoVolumeMap: {
                            catbox: {
                                0: -20,
                                480: -20,
                                720: -20,
                            },
                        },
                    },
                });
            } else {
                readySong(songNumber + 1);
                if (quiz.isHost) {
                    let nextSong = finalSongList[songOrder[songNumber + 1]];
                    let message = `${songNumber + 1}§${getStartPoint()}§${nextSong.audio || ""}§${nextSong.video480 || ""}§${nextSong.video720 || ""}`;
                    splitIntoChunks(btoa(encodeURIComponent(message)) + "$", 144).forEach((item, index) => {
                        cslMessage("§CSL3" + base10to36(index % 36) + item);
                    });
                }
            }
        }
    }, 100);
}

// end guess phase and display answer
function endGuessPhase(songNumber) {
    if (!quiz.cslActive || !quiz.inQuiz) return reset();
    let song;
    if (quiz.isHost) {
        song = finalSongList[songOrder[songNumber]];
        console.log("song found ", song);
    }
    fireListener("guess phase over");
    if (!quiz.soloMode && quiz.inQuiz && !quiz.isSpectator) {
        let answer = currentAnswers[quiz.ownGamePlayerId];
        if (answer) {
            splitIntoChunks(btoa(encodeURIComponent(answer)) + "$", 144).forEach((item, index) => {
                cslMessage("§CSL5" + base10to36(index % 36) + item);
            });
        }
    }
    answerTimer = setTimeout(
        () => {
            if (!quiz.cslActive || !quiz.inQuiz) return reset();
            cslState = 2;
            skipping = false;
            if (!quiz.soloMode) {
                for (let player of Object.values(quiz.players)) {
                    currentAnswers[player.gamePlayerId] = answerChunks[player.gamePlayerId] ? answerChunks[player.gamePlayerId].decode() : "";
                }
            }
            for (let key of Object.keys(quiz.players)) {
                cslMultiplayer.voteSkip[key] = false;
            }
            let data = {
                answers: [],
                progressBarState: null,
            };
            for (let player of Object.values(quiz.players)) {
                data.answers.push({
                    gamePlayerId: player.gamePlayerId,
                    pose: 3,
                    answer: currentAnswers[player.gamePlayerId] || "",
                });
            }
            fireListener("player answers", data);
            if (!quiz.soloMode && quiz.isHost) {
                let message = `${song.animeRomajiName || ""}\n${song.animeEnglishName || ""}\n${(song.altAnimeNames || []).join("\t")}\n${(song.altAnimeNamesAnswers || []).join("\t")}\n${song.songArtist || ""}\n${song.songName || ""}\n${
                    song.songType || ""
                }\n${song.songTypeNumber || ""}\n${song.songDifficulty || ""}\n${song.animeType || ""}\n${song.animeVintage || ""}\n${song.annId || ""}\n${song.malId || ""}\n${song.kitsuId || ""}\n${song.aniListId ||
                     ""}\n${
                    Array.isArray(song.animeTags) ? song.animeTags.join(",") : ""
                }\n${Array.isArray(song.animeGenre) ? song.animeGenre.join(",") : ""}\n${song.audio || ""}\n${song.video480 || ""}\n${song.video720 || ""}`;
                splitIntoChunks(btoa(encodeURIComponent(message)) + "$", 144).forEach((item, index) => {
                    cslMessage("§CSL7" + base10to36(index % 36) + item);
                });
            }
            answerTimer = setTimeout(
                () => {
                    if (!quiz.cslActive || !quiz.inQuiz) return reset();
                    let correct = {};
                    let pose = {};
                    if (quiz.isHost) {
                        for (let player of Object.values(quiz.players)) {
                            let isCorrect = isCorrectAnswer(songNumber, currentAnswers[player.gamePlayerId]);
                            correct[player.gamePlayerId] = isCorrect;
                            pose[player.gamePlayerId] = currentAnswers[player.gamePlayerId] ? (isCorrect ? 5 : 4) : 6;
                            if (isCorrect) score[player.gamePlayerId]++;
                        }
                    }
                    if (quiz.soloMode) {
                        let data = {
                            players: [],
                            songInfo: {
                                animeNames: {
                                    english: song.animeEnglishName,
                                    romaji: song.animeRomajiName,
                                },
                                artist: song.songArtist,
                                songName: song.songName,
                                videoTargetMap: {
                                    catbox: {
                                        0: formatTargetUrl(song.audio),
                                        480: formatTargetUrl(song.video480),
                                        720: formatTargetUrl(song.video720),
                                    },
                                },
                                type: song.songType,
                                typeNumber:song.typeNumber,
                                annId: song.annId,
                                highRisk: 0,
                                animeScore: song.rating,
                                animeType: song.animeType,
                                vintage: song.animeVintage,
                                animeDifficulty: song.songDifficulty,
                                animeTags: song.animeTags,
                                animeGenre: song.animeGenre,
                                altAnimeNames: song.altAnimeNames,
                                altAnimeNamesAnswers: song.altAnimeNamesAnswers,
                                rebroadcast: song.rebroadcast,
                                dub: song.dub,
                                siteIds: {
                                    annId: song.annId,
                                    malId: song.malIdt,
                                    kitsuId: song.kitsuId,
                                    aniListId: song.aniListId,
                                },
                            },
                            progressBarState: {
                                length: 25,
                                played: 0,
                            },
                            groupMap: createGroupSlotMap(Object.keys(quiz.players)),
                            watched: false,
                        };
                        for (let player of Object.values(quiz.players)) {
                            data.players.push({
                                gamePlayerId: player.gamePlayerId,
                                pose: pose[player.gamePlayerId],
                                level: quiz.players[player.gamePlayerId].level,
                                correct: correct[player.gamePlayerId],
                                score: score[player.gamePlayerId],
                                listStatus: null,
                                showScore: null,
                                position: Math.floor(player.gamePlayerId / 8) + 1,
                                positionSlot: player.gamePlayerId % 8,
                            });
                        }
                        fireListener("answer results", data);
                        console.log("data song : ", data);
                    } else if (quiz.isHost) {
                        let list = [];
                        for (let id of Object.keys(correct)) {
                            list.push(`${id},${correct[id] ? "1" : "0"},${pose[id]},${score[id]}`);
                        }
                        splitIntoChunks(btoa(encodeURIComponent(list.join("§"))) + "$", 144).forEach((item, index) => {
                            cslMessage("§CSL6" + base10to36(index % 36) + item);
                        });
                    }
                    setTimeout(
                        () => {
                            if (!quiz.cslActive || !quiz.inQuiz) return reset();
                            if (quiz.soloMode) {
                                skipInterval = setInterval(() => {
                                    if (quiz.skipController._toggled) {
                                        clearInterval(skipInterval);
                                        endReplayPhase(songNumber);
                                    }
                                }, 100);
                            }
                        },
                        fastSkip ? 1000 : 2000
                    );
                },
                fastSkip ? 200 : 3000
            );
        },
        fastSkip ? 100 : 400
    );
}

// end replay phase
function endReplayPhase(songNumber) {
    if (!quiz.cslActive || !quiz.inQuiz) return reset();
    //console.log(`end replay phase (${songNumber})`);
    if (songNumber < totalSongs) {
        fireListener("quiz overlay message", "Skipping to Next Song");
        setTimeout(
            () => {
                previousSongFinished = true;
            },
            fastSkip ? 1000 : 3000
        );
    } else {
        fireListener("quiz overlay message", "Skipping to Final Standings");
        setTimeout(
            () => {
                let data = {
                    resultStates: [],
                };
                /*"progressBarState": {
                "length": 26.484,
                "played": 6.484
            }*/
                let sortedScores = Array.from(new Set(Object.values(score))).sort((a, b) => b - a);
                for (let id of Object.keys(score)) {
                    data.resultStates.push({
                        gamePlayerId: parseInt(id),
                        pose: 1,
                        endPosition: sortedScores.indexOf(score[id]) + 1,
                    });
                }
                fireListener("quiz end result", data);
            },
            fastSkip ? 2000 : 5000

        );
        setTimeout(
            () => {
                if (quiz.soloMode) {
                    quizOver();
                } else if (quiz.isHost) {
                    cslMessage("§CSL10");
                }
            },
            fastSkip ? 5000 : 12000
        );
    }
}

// fire all event listeners (including scripts)
function fireListener(type, data) {
    try {
        console.log(`Firing listener for event type: "${type}"`);
        console.log("Data being passed:", data);
        for (let listener of socket.listners[type]) {
            console.log("Listener fire method:", listener.fire.toString());
            listener.fire(data);
        }
    } catch (error) {
        sendSystemMessage(`CSL Error: "${type}" listener failed`);
        console.error(error);
        console.log(type);
        console.log(data);
    }
}

// send csl chat message
function cslMessage(text) {
    if (!isRankedMode()) {
        socket.sendCommand({ type: "lobby", command: "game chat message", data: { msg: String(text), teamMessage: false } });
    }
}

// send a client side message to game chat
function sendSystemMessage(message) {
    if (gameChat.open) {
        setTimeout(() => {
            gameChat.systemMessage(String(message));
        }, 1);
    }
}

// parse message
function parseMessage(content, sender) {
    if (isRankedMode()) return;
    let player;
    if (lobby.inLobby) player = Object.values(lobby.players).find((x) => x._name === sender);
    else if (quiz.inQuiz) player = Object.values(quiz.players).find((x) => x._name === sender);
    let isHost = sender === cslMultiplayer.host;
    if (content.startsWith("§CSL0")) {
        //start quiz
        if (lobby.inLobby && sender === lobby.hostName && !quiz.cslActive) {
            let split = atob(content.slice(5)).split("§");
            if (split.length === 6) {
                //mode = parseInt(split[0]);
                currentSong = parseInt(split[1]);
                totalSongs = parseInt(split[2]);
                guessTime = parseInt(split[3]);
                extraGuessTime = parseInt(split[4]);
                fastSkip = Boolean(parseInt(split[5]));
                sendSystemMessage(`CSL: starting multiplayer quiz (${totalSongs} songs)`);
                startQuiz();
            }
        }
    } else if (quiz.cslActive && quiz.inQuiz && cslMultiplayer.host !== lobby.hostName) {
        sendSystemMessage("client out of sync, quitting CSL");
        quizOver();
    } else if (content === "§CSL10") {
        //return to lobby
        if (quiz.cslActive && quiz.inQuiz && (isHost || sender === lobby.hostName)) {
            quizOver();
        }
    } else if (content === "§CSL11") {
        //pause
        if (quiz.cslActive && isHost) {
            fireListener("quiz pause triggered", {
                playerName: sender,
            });
        }
    } else if (content === "§CSL12") {
        //unpause
        if (quiz.cslActive && isHost) {
            fireListener("quiz unpause triggered", {
                playerName: sender,
            });
        }
    } else if (content === "§CSL13") {
        //player answered
        if (quiz.cslActive && player) {
            fireListener("player answered", [player.gamePlayerId]);
        }
    } else if (content === "§CSL14") {
        //vote skip
        if (quiz.cslActive && quiz.isHost && player) {
            cslMultiplayer.voteSkip[player.gamePlayerId] = true;
            if (!skipping && checkVoteSkip()) {
                skipping = true;
                if (cslState === 1) {
                    cslMessage("§CSL15");
                } else if (cslState === 2) {
                    cslMessage("§CSL16");
                }
            }
        }
    } else if (content === "§CSL15") {
        //skip guessing phase
        if (quiz.cslActive && isHost) {
            fireListener("quiz overlay message", "Skipping to Answers");
            clearInterval(skipInterval);
            clearTimeout(endGuessTimer);
            clearTimeout(extraGuessTimer);
            setTimeout(
                () => {
                    endGuessPhase(currentSong);
                },
                fastSkip ? 1000 : 3000
            );
        }
    } else if (content === "§CSL16") {
        //skip replay phase
        if (quiz.cslActive && isHost) {
            endReplayPhase(currentSong);
        }
    } else if (content.startsWith("§CSL17")) {
        //player rejoin
        if (sender === lobby.hostName) {
            let name = atob(content.slice(6));
            if (name === selfName) {
                socket.sendCommand({ type: "lobby", command: "change to player" });
            } else if (quiz.cslActive && quiz.inQuiz) {
                let player = Object.values(quiz.players).find((p) => p._name === name);
                if (player) {
                    fireListener("Rejoining Player", { name: name, gamePlayerId: player.gamePlayerId });
                }
            }
        }
    } else if (content === "§CSL21") {
        //has autocomplete
        cslMessage(`Autocomplete: ${autocomplete.length ? "✅" : "⛔"}`);
    } else if (content === "§CSL22") {
        //version
        cslMessage(`CSL version ${version}`);
    } else if (content.startsWith("§CSL3")) {
        //next song link
        if (quiz.cslActive && isHost) {
            //§CSL3#songNumber§startPoint§mp3§480§720
            nextSongChunk.append(content);
            if (nextSongChunk.isComplete) {
                let split = nextSongChunk.decode().split("§");
                nextSongChunk = new Chunk();
                if (split.length === 5) {
                    if (!songLinkReceived[split[0]]) {
                        songLinkReceived[split[0]] = true;
                        fireListener("quiz next video info", {
                            playLength: guessTime,
                            playbackSpeed: 1,
                            startPont: parseInt(split[1]),
                            videoInfo: {
                                id: null,
                                videoMap: {
                                    catbox: createCatboxLinkObject(split[2], split[3], split[4]),
                                },
                                videoVolumeMap: {
                                    catbox: {
                                        0: -20,
                                        480: -20,
                                        720: -20,
                                    },
                                },
                            },
                        });
                        if (Object.keys(songLinkReceived).length === 1) {
                            setTimeout(() => {
                                fireListener("quiz ready", {
                                    numberOfSongs: totalSongs,
                                });
                            }, 200);
                            setTimeout(() => {
                                fireListener("quiz waiting buffering", {
                                    firstSong: true,
                                });
                            }, 300);
                            setTimeout(() => {
                                previousSongFinished = true;
                                readySong(currentSong + 1);
                            }, 400);
                        }
                    }
                } else {
                    sendSystemMessage(`CSL Error: next song link decode failed`);
                }
            }
        }
    } else if (content.startsWith("§CSL4")) {
        //play song
        if (quiz.cslActive && isHost) {
            let number = parseInt(atob(content.slice(5)));
            //console.log("Play song: " + number);
            if (currentSong !== totalSongs) {
                playSong(number);
            }
        }
    } else if (content.startsWith("§CSL5")) {
        //player final answer
        if (quiz.cslActive && player) {
            if (!answerChunks[player.gamePlayerId]) answerChunks[player.gamePlayerId] = new Chunk();
            answerChunks[player.gamePlayerId].append(content);
        }
    } else if (content.startsWith("§CSL6")) {
        //answer results
        if (quiz.cslActive && isHost) {
            resultChunk.append(content);
            if (resultChunk.isComplete) {
                let split = resultChunk.decode().split("§");
                let data = {
                    players: [],
                    songInfo: {
                        animeNames: {
                            english: cslMultiplayer.songInfo.animeEnglishName,
                            romaji: cslMultiplayer.songInfo.animeRomajiName,
                        },
                        artist: cslMultiplayer.songInfo.songArtist,
                        songName: cslMultiplayer.songInfo.songName,
                        videoTargetMap: {
                            catbox: {
                                0: formatTargetUrl(cslMultiplayer.songInfo.audio) || "",
                                480: formatTargetUrl(cslMultiplayer.songInfo.video480) || "",
                                720: formatTargetUrl(cslMultiplayer.songInfo.video720) || "",
                            },
                        },
                        type: cslMultiplayer.songInfo.songType,
                        typeNumber: cslMultiplayer.songInfo.songTypeNumber,
                        annId: cslMultiplayer.songInfo.annId,
                        highRisk: 0,
                        animeScore: null,
                        animeType: cslMultiplayer.songInfo.animeType,
                        vintage: cslMultiplayer.songInfo.animeVintage,
                        animeDifficulty: cslMultiplayer.songInfo.songDifficulty || 0,
                        animeTags: cslMultiplayer.songInfo.animeTags || [],
                        animeGenre: cslMultiplayer.songInfo.animeGenre || [],
                        altAnimeNames: cslMultiplayer.songInfo.altAnimeNames || [],
                        altAnimeNamesAnswers: cslMultiplayer.songInfo.altAnimeNamesAnswers || [],
                        siteIds: {
                            annId: cslMultiplayer.songInfo.annId,
                            malId: cslMultiplayer.songInfo.malId,
                            kitsuId: cslMultiplayer.songInfo.kitsuId,
                            aniListId: cslMultiplayer.songInfo.aniListId,
                        },
                    },
                    progressBarState: {
                        length: 25,
                        played: 0,
                    },
                    groupMap: createGroupSlotMap(Object.keys(quiz.players)),
                    watched: false,
                };
                let decodedPlayers = [];
                for (p of split) {
                    let playerSplit = p.split(",");
                    decodedPlayers.push({
                        id: parseInt(playerSplit[0]),
                        correct: Boolean(parseInt(playerSplit[1])),
                        pose: parseInt(playerSplit[2]),
                        score: parseInt(playerSplit[3]),
                    });
                }
                decodedPlayers.sort((a, b) => b.score - a.score);
                decodedPlayers.forEach((p, i) => {
                    data.players.push({
                        gamePlayerId: p.id,
                        pose: p.pose,
                        level: quiz.players[p.id].level,
                        correct: p.correct,
                        score: p.score,
                        listStatus: null,
                        showScore: null,
                        position: Math.floor(i / 8) + 1,
                        positionSlot: i % 8,
                    });
                });
                //console.log(data.players);
                fireListener("answer results", data);
            }
        }
    } else if (content.startsWith("§CSL7")) {
        songInfoChunk.append(content);
        if (songInfoChunk.isComplete) {
            let split = preventCodeInjection(songInfoChunk.decode()).split("\n");
            cslMultiplayer.songInfo.animeRomajiName = split[0];
            cslMultiplayer.songInfo.animeEnglishName = split[1];
            cslMultiplayer.songInfo.altAnimeNames = split[2].split("\t").filter(Boolean);
            cslMultiplayer.songInfo.altAnimeNamesAnswers = split[3].split("\t").filter(Boolean);
            cslMultiplayer.songInfo.songArtist = split[4];
            cslMultiplayer.songInfo.songName = split[5];
            cslMultiplayer.songInfo.songType = parseInt(split[6]) || null;
            cslMultiplayer.songInfo.songTypeNumber = parseInt(split[7]) || null;
            cslMultiplayer.songInfo.songDifficulty = parseFloat(split[8]) || null;
            cslMultiplayer.songInfo.animeType = split[9];
            cslMultiplayer.songInfo.animeVintage = split[10];
            cslMultiplayer.songInfo.annId = parseInt(split[11]) || null;
            cslMultiplayer.songInfo.malId = parseInt(split[12]) || null;
            cslMultiplayer.songInfo.kitsuId = parseInt(split[13]) || null;
            cslMultiplayer.songInfo.aniListId = parseInt(split[14]) || null;
            cslMultiplayer.songInfo.animeTags = split[15].split(",");
            cslMultiplayer.songInfo.animeGenre = split[16].split(",");
            cslMultiplayer.songInfo.audio = split[17];
            cslMultiplayer.songInfo.video480 = split[18];
            cslMultiplayer.songInfo.video720 = split[19];
            console.log(split);
        }
    }
}

function checkVoteSkip() {
    let keys = Object.keys(cslMultiplayer.voteSkip).filter((key) => quiz.players.hasOwnProperty(key) && !quiz.players[key].avatarDisabled);
    for (let key of keys) {
        if (!cslMultiplayer.voteSkip[key]) return false;
    }
    return true;
}

// input list of player keys, return group slot map
function createGroupSlotMap(players) {
    players = players.map(Number);
    let map = {};
    let group = 1;
    if (Object.keys(score).length) players.sort((a, b) => score[b] - score[a]);
    for (let i = 0; i < players.length; i += 8) {
        map[group] = players.slice(i, i + 8);
        group++;
    }
    return map;
}

// check if the player's answer is correct
function isCorrectAnswer(songNumber, answer) {
    let song = finalSongList[songOrder[songNumber]];
    if (!answer) {
        reviewSong(song, false);
        return false;
    }
    answer = answer.toLowerCase();
    let correctAnswers = [].concat(song.altAnimeNames || [], song.altAnimeNamesAnswers || []);
    for (let a1 of correctAnswers) {
        let a2 = replacedAnswers[a1];
        if (a2 && a2.toLowerCase() === answer) {
            reviewSong(song, true);
            return true;
        }
        if (a1.toLowerCase() === answer) {
            reviewSong(song, true);
            return true;
        }
    }
    reviewSong(song, false);
    return false;
}

// get start point value (0-100)
function getStartPoint() {
    return Math.floor(Math.random() * (startPointRange[1] - startPointRange[0] + 1)) + startPointRange[0];
}

// return true if song type is allowed
function songTypeFilter(song, ops, eds, ins) {
    let type = song.songType;
    if (ops && type === 1) return true;
    if (eds && type === 2) return true;
    if (ins && type === 3) return true;
    return false;
}

// return true if anime type is allowed
function animeTypeFilter(song, tv, movie, ova, ona, special) {
    if (song.animeType) {
        let type = song.animeType.toLowerCase();
        if (tv && type === "tv") return true;
        if (movie && type === "movie") return true;
        if (ova && type === "ova") return true;
        if (ona && type === "ona") return true;
        if (special && type === "special") return true;
        return false;
    } else {
        return tv && movie && ova && ona && special;
    }
}

// return true if the song difficulty is in allowed range
function difficultyFilter(song, low, high) {
    if (low === 0 && high === 100) return true;
    let dif = parseFloat(song.songDifficulty);
    if (isNaN(dif)) return false;
    if (dif >= low && dif <= high) return true;
    return false;
}

// return true if guess type is allowed
function guessTypeFilter(song, correctGuesses, incorrectGuesses) {
    if (correctGuesses && song.correctGuess) return true;
    if (incorrectGuesses && song.incorrectGuess) return true;
    return false;
}

// clear all intervals and timeouts
function clearTimeEvents() {
    clearInterval(nextVideoReadyInterval);
    clearInterval(skipInterval);
    clearTimeout(endGuessTimer);
    clearTimeout(extraGuessTimer);
    clearTimeout(answerTimer);
}

// reset variables from this script
function reset() {
    clearTimeEvents();
    quiz.cslActive = false;
    cslMultiplayer = { host: "", songInfo: {}, voteSkip: {} };
    cslState = 0;
    currentSong = 0;
    currentAnswers = {};
    score = {};
    previousSongFinished = false;
    fastSkip = false;
    skipping = false;
    songLinkReceived = {};
    answerChunks = {};
    songInfoChunk = new Chunk();
    nextSongChunk = new Chunk();
}

// end quiz and set up lobby
function quizOver() {
    reset();
    let data = {
        spectators: [],
        inLobby: true,
        settings: hostModal.getSettings(),
        soloMode: quiz.soloMode,
        inQueue: [],
        hostName: lobby.hostName,
        gameId: lobby.gameId,
        players: [],
        numberOfTeams: 0,
        teamFullMap: {},
    };
    for (let player of Object.values(quiz.players)) {
        if (gameChat.spectators.some((spectator) => spectator.name === player._name)) {
            data.spectators.push({
                name: player._name,
                gamePlayerId: null,
            });
        } else if (!player.avatarDisabled) {
            data.players.push({
                name: player._name,
                gamePlayerId: player.gamePlayerId,
                level: player.level,
                avatar: player.avatarInfo,
                ready: true,
                inGame: true,
                teamNumber: null,
                multipleChoice: false,
            });
        }
    }
    lobby.setupLobby(
        data,
        gameChat.spectators.some((spectator) => spectator.name === selfName)
    );
    viewChanger.changeView("lobby", { supressServerMsg: true, keepChatOpen: true });
}

function openStatsModal() {
    console.log("Tried to open Stats Modal");
    console.log(statsModal);
    if (!statsModal) {
        createStatsModal();
    }
    updateStatsContent();
    statsModal.modal("show");
}

function createStatsModal() {
    console.log("Creating Stats Modal");
    statsModal = $(`
    <div class="modal fade" id="statsModal" tabindex="-1" role="dialog">
      <div class="modal-dialog" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
            <h4 class="modal-title">Song Statistics</h4>
          </div>
          <div class="modal-body">
            <!-- Content will be dynamically inserted here -->
          </div>
        </div>
      </div>
    </div>
  `);
    $("#gameContainer").append(statsModal);
}

function updateStatsContent() {
    console.log("Updating Stats Content");
    const reviewData = JSON.parse(localStorage.getItem(`spacedRepetitionData_${currentProfile}`)) || {};
    const $modalBody = $("#statsModal .modal-body");
    $modalBody.empty();

    // Overall statistics
    const totalSongs = Object.keys(reviewData).length;
    const correctSongs = Object.values(reviewData).filter((song) => song.isLastTryCorrect).length;
    const incorrectSongs = totalSongs - correctSongs;

    // Most difficult songs
    const difficultSongs = Object.entries(reviewData)
        .sort((a, b) => b[1].failureCount - a[1].failureCount)
        .slice(0, 10);

    // Recently reviewed songs
    const recentSongs = Object.entries(reviewData)
        .sort((a, b) => b[1].lastReviewDate - a[1].lastReviewDate)
        .slice(0, 10);

    // E-Factor distribution
    const efactorRanges = {
        "1.0 - 1.5": 0,
        "1.5 - 2.0": 0,
        "2.0 - 2.5": 0,
        "2.5 - 3.0": 0,
        "3.0+": 0,
    };

    Object.values(reviewData).forEach((song) => {
        if (song.efactor < 1.5) efactorRanges["1.0 - 1.5"]++;
        else if (song.efactor < 2.0) efactorRanges["1.5 - 2.0"]++;
        else if (song.efactor < 2.5) efactorRanges["2.0 - 2.5"]++;
        else if (song.efactor < 3.0) efactorRanges["2.5 - 3.0"]++;
        else efactorRanges["3.0+"]++;
    });

    $modalBody.append(`
      <div class="stats-section">
        <h3>Overall Statistics</h3>
        <p>Total Songs: ${totalSongs}</p>
        <p>Correct Guesses: ${correctSongs}</p>
        <p>Incorrect Guesses: ${incorrectSongs}</p>
        <p>Accuracy: ${((correctSongs / totalSongs) * 100).toFixed(2)}%</p>
      </div>
    `);

    $modalBody.append(`
      <div class="stats-section">
        <h3>Difficulty Distribution</h3>
        <h5>Higher means better recognized</h5>
        <table class="stats-table">
          <tr>
            <th>Difficulty Range</th>
            <th>Number of Songs</th>
          </tr>
          ${Object.entries(efactorRanges)
              .map(
                  ([range, count]) => `
            <tr>
              <td>${range}</td>
              <td>${count}</td>
            </tr>
          `
              )
              .join("")}
        </table>
      </div>
    `);

    $modalBody.append(`
    <div class="stats-section">
      <h3>Most Difficult Songs</h3>
      <table class="stats-table">
        <tr>
          <th>Song</th>
          <th>Failures</th>
          <th>Successes</th>
          <th>Last Correct</th>
        </tr>
        ${difficultSongs
            .map(
                ([song, data]) => `
          <tr>
            <td>${song}</td>
            <td>${data.failureCount}</td>
            <td>${data.successCount}</td>
            <td>${data.isLastTryCorrect ? "Yes" : "No"}</td>
          </tr>
        `
            )
            .join("")}
      </table>
    </div>
  `);

    $modalBody.append(`
    <div class="stats-section">
      <h3>Recently Reviewed Songs</h3>
      <table class="stats-table">
        <tr>
          <th>Song</th>
          <th>Last Review Date</th>
          <th>Result</th>
        </tr>
        ${recentSongs
            .map(
                ([song, data]) => `
          <tr>
            <td>${song}</td>
            <td>${new Date(data.lastReviewDate).toLocaleString()}</td>
            <td>${data.isLastTryCorrect ? "Correct" : "Incorrect"}</td>
          </tr>
        `
            )
            .join("")}
      </table>
    </div>
  `);
}

function initializePopovers() {
    $("#maxNewSongsInfo").popover({
        trigger: "hover",
        placement: "auto",
        content: "Maximum number of new songs to introduce in a 24-hour period.",
    });

    $("#incorrectSongsInfo").popover({
        trigger: "hover",
        placement: "auto",
        content: "Number of songs you previously got incorrect to include in each game.",
    });

    $("#correctSongsInfo").popover({
        trigger: "hover",
        placement: "auto",
        content: "Number of songs you previously got correct to include in each game.",
    });

    $("#repeatModeInfo").popover({
        trigger: "hover",
        placement: "auto",
        html: true,
        content: `
            <p>When enabled, only songs played earlier with difficulty in the specified range will be selected.</p>
            <p>Max New Songs, Incorrect Songs per Game, and Correct Songs per Game settings are ignored in this mode.</p>
            <p>Difficulty range: 1.0 (most difficult) to 5.0 (easiest)</p>
        `,
    });
}

function setupRepeatMode() {
    $("#cslgSettingsRepeatMode").change(function () {
        $("#cslgSettingsRepeatModeRange").prop("disabled", !this.checked);
        if (this.checked) {
            $("#cslgSettingsMaxNewSongs, #cslgSettingsIncorrectSongs, #cslgSettingsCorrectSongs").prop("disabled", true);
        } else {
            $("#cslgSettingsMaxNewSongs, #cslgSettingsIncorrectSongs, #cslgSettingsCorrectSongs").prop("disabled", false);
        }
    });

    $("#cslgSettingsRepeatModeRange").on("input", function () {
        let range = $(this).val().split("-");
        if (range.length === 2 && !isNaN(parseFloat(range[0])) && !isNaN(parseFloat(range[1]))) {
            $(this).css("background-color", "");
        } else {
            $(this).css("background-color", "#ffcccc");
        }
    });
}

function updateSongListDisplay() {
    updateModeDisplay();
    const showIgnored = $("#cslgShowIgnoredButton").hasClass("active");
    const displayList = showIgnored ? ignoredSongs : isSearchMode ? songList : mySongList;
    createSongListTable(displayList);
}

function miscSetup() {
    const songOptionsButton = $("#songOptionsButton");
    const songOptionsPopup = $(".song-options-popup");
    const songOptionsBackdrop = $(".song-options-backdrop");
    const songOptionsClose = $(".song-options-close");

    songOptionsButton.on("click", function () {
        songOptionsPopup.addClass("show");
        songOptionsBackdrop.addClass("show");
    });


    function closeSongOptions() {
        songOptionsPopup.removeClass("show");
        songOptionsBackdrop.removeClass("show");
    }

    songOptionsClose.on("click", closeSongOptions);
    songOptionsBackdrop.on("click", closeSongOptions);

    $(document).on("keydown", function (e) {
        if (e.key === "Escape") {
            closeSongOptions();
        }
    });

    songOptionsPopup.on("click", function (e) {
        e.stopPropagation();
    });

    $("#trainingInfoLink").on("click", function (e) {
        e.preventDefault();
        showTrainingInfo();
    });
}

// open custom song list settings modal
function openSettingsModal() {
    $("#cslgSettingsCorrectGuessCheckbox, #cslgSettingsIncorrectGuessCheckbox").prop("disabled", true);
    updateSongListDisplay();
    updateModeDisplay();
    initializePopovers();
    setupRepeatMode();
    loadNewSongsSettings();
    miscSetup();
    $("#cslgSettingsMaxNewSongs").val(maxNewSongs24Hours);
    $("#cslgSettingsIncorrectSongs").val(incorrectSongsPerGame);
    $("#cslgSettingsCorrectSongs").val(correctSongsPerGame);
    if (lobby.inLobby) {
        if (autocomplete.length) {
            $("#cslgAutocompleteButton").removeClass("btn-danger").addClass("btn-success disabled");
        }

        // Initialize the mode and update display
        updateModeDisplay();

        $("#cslgSettingsModal").modal("show");
        initializePopovers();
    }
}

function updateModeDisplay() {
    // Update button text
    $("#cslgToggleModeButton").text(isSearchMode ? "Song Search" : "My Songs");

    // Toggle body class for CSS targeting
    $("body").toggleClass("song-search-mode", isSearchMode);

    // Show/hide AnisongDB search elements
    $(".anisongdb-search-row").toggle(isSearchMode);

    // Update other UI elements
    if (isSearchMode) {
        createSongListTable(songList);
        $("#cslgAnisongdbSearchRow").show();
        $("#cslgAddAllButton").attr("title", "Add all to My Songs");
        $("#cslgTransferSongListButton").attr("title", "Transfer from merged to search results");
    } else {
        createSongListTable(mySongList);
        $("#cslgAnisongdbSearchRow").hide();
        $("#cslgAddAllButton").attr("title", "Add all to merged");
        $("#cslgTransferSongListButton").attr("title", "Transfer from merged to My Songs");
    }

    // Update song count display
    $("#cslgSongListCount").text("Songs: " + (isSearchMode ? songList.length : mySongList.length));

    // Update popovers content
    if ($("#cslgAddAllButton").data("bs.popover")) {
        $("#cslgAddAllButton").data("bs.popover").options.content = isSearchMode ? "Add all to My Songs" : "Add all to merged";
    }
    if ($("#cslgTransferSongListButton").data("bs.popover")) {
        $("#cslgTransferSongListButton").data("bs.popover").options.content = isSearchMode ? "Transfer from merged to search results" : "Transfer from merged to My Songs";
    }
}

// when you click the go button
function anisongdbDataSearch() {
    let mode = $("#cslgAnisongdbModeSelect").val().toLowerCase();
    let query = $("#cslgAnisongdbQueryInput").val();
    let ops = $("#cslgAnisongdbOPCheckbox").prop("checked");
    let eds = $("#cslgAnisongdbEDCheckbox").prop("checked");
    let ins = $("#cslgAnisongdbINCheckbox").prop("checked");
    let partial = $("#cslgAnisongdbPartialCheckbox").prop("checked");
    let ignoreDuplicates = $("#cslgAnisongdbIgnoreDuplicatesCheckbox").prop("checked");
    let arrangement = $("#cslgAnisongdbArrangementCheckbox").prop("checked");
    let maxOtherPeople = parseInt($("#cslgAnisongdbMaxOtherPeopleInput").val());
    let minGroupMembers = parseInt($("#cslgAnisongdbMinGroupMembersInput").val());
    if (query && !isNaN(maxOtherPeople) && !isNaN(minGroupMembers)) {
        getAnisongdbData(mode, query, ops, eds, ins, partial, ignoreDuplicates, arrangement, maxOtherPeople, minGroupMembers);
    }
}

// send anisongdb request
function getAnisongdbData(mode, query, ops, eds, ins, partial, ignoreDuplicates, arrangement, maxOtherPeople, minGroupMembers) {
    $("#cslgSongListCount").text("Loading...");
    $("#cslgSongListTable tbody").empty();
    let url, data;
    let json = {
        and_logic: false,
        ignore_duplicate: ignoreDuplicates,
        opening_filter: ops,
        ending_filter: eds,
        insert_filter: ins,
    };
    if (mode === "anime") {
        url = "https://anisongdb.com/api/search_request";
        json.anime_search_filter = {
            search: query,
            partial_match: partial,
        };
    } else if (mode === "artist") {
        url = "https://anisongdb.com/api/search_request";
        json.artist_search_filter = {
            search: query,
            partial_match: partial,
            group_granularity: minGroupMembers,
            max_other_artist: maxOtherPeople,
        };
    } else if (mode === "song") {
        url = "https://anisongdb.com/api/search_request";
        json.song_name_search_filter = {
            search: query,
            partial_match: partial,
        };
    } else if (mode === "composer") {
        url = "https://anisongdb.com/api/search_request";
        json.composer_search_filter = {
            search: query,
            partial_match: partial,
            arrangement: arrangement,
        };
    } else if (mode === "season") {
        query = query.trim();
        query = query.charAt(0).toUpperCase() + query.slice(1).toLowerCase();
        url = `https://anisongdb.com/api/filter_season?${new URLSearchParams({ season: query })}`;
    } else if (mode === "ann id") {
        url = "https://anisongdb.com/api/annId_request";
        json.annId = parseInt(query);
    } else if (mode === "mal id") {
        url = "https://anisongdb.com/api/malIDs_request";
        json.malIds = query
            .split(/[, ]+/)
            .map((n) => parseInt(n))
            .filter((n) => !isNaN(n));
    }
    if (mode === "season") {
        data = {
            method: "GET",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
        };
    } else {
        data = {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(json),
        };
    }
    fetch(url, data)
        .then((res) => res.json())
        .then((json) => {
            handleData(json);
            console.log("final song list : " , finalSongList);
            songList = finalSongList.filter((song) => {
            // Check and set the songType and typeNumber
            let songType = song.songType;
            if (songType.startsWith("Opening")) {
                song.songType = 1;
                song.typeNumber = parseInt(songType.replace(/\D/g, '')); // Extract the number
            } else if (songType.startsWith("Ending")) {
                song.songType = 2;
                song.typeNumber = parseInt(songType.replace(/\D/g, ''));
            } else if (songType === "Insert Song") {
                song.songType = 3;
                song.typeNumber = null; // No type number for Insert Song
            }});
            songList = finalSongList.filter((song) => songTypeFilter(song, ops, eds, ins));
            console.log("song list : " , songList);
            setSongListTableSort();
            if (!Array.isArray(json)) {
                $("#cslgSongListCount").text("Songs: 0");
                $("#cslgSongListTable tbody").empty();
                $("#cslgSongListWarning").text(JSON.stringify(json));
            } else if (songList.length === 0 && (ranked.currentState === ranked.RANKED_STATE_IDS.RUNNING || ranked.currentState === ranked.RANKED_STATE_IDS.CHAMP_RUNNING)) {
                $("#cslgSongListCount").text("Songs: 0");
                $("#cslgSongListTable tbody").empty();
                $("#cslgSongListWarning").text("AnisongDB is not available during ranked");
            } else {
                updateSongListDisplay();
            }
            createAnswerTable();
        })
        .catch((res) => {
            songList = [];
            setSongListTableSort();
            $("#cslgSongListCount").text("Songs: 0");
            $("#cslgSongListTable tbody").empty();
            $("#cslgSongListWarning").text(res.toString());
        });
}

function handleData(data) {
    finalSongList = [];
    if (!data) return;
    loadIgnoredSongs(); // Load the latest ignored songs
    // anisongdb structure
    if (Array.isArray(data) && data.length && data[0].animeJPName) {
        data = data.filter((song) => song.audio || song.MQ || song.HQ);
        for (let song of data) {
            finalSongList.push({
                animeRomajiName: song.animeJPName,
                animeEnglishName: song.animeENName,
                altAnimeNames: [].concat(song.animeJPName, song.animeENName, song.animeAltName || []),
                altAnimeNamesAnswers: [],
                songArtist: song.songArtist,
                songName: song.songName,
                songType: song.songType,
                songTypeNumber: song.typeNumber,
                songDifficulty: song.songDifficulty,
                animeType: song.animeType,
                animeVintage: song.animeVintage,
                annId: song.annId,
                malId: song.linked_ids?.myanimelist,
                kitsuId: song.linked_ids?.kitsu,
                aniListId: song.linked_ids?.anilist,
                animeTags: song.animeTags,
                animeGenre: song.animeGenre,
                rebroadcast: null,
                dub: null,
                startPoint: null,
                audio: song.audio,
                video480: song.MQ,
                video720: song.HQ,
                correctGuess: true,
                incorrectGuess: true,
            });
        }
        for (let song of finalSongList) {
            let otherAnswers = new Set();
            for (let s of finalSongList) {
                if (s.songName === song.songName && s.songArtist === song.songArtist) {
                    s.altAnimeNames.forEach((x) => otherAnswers.add(x));
                }
            }
            song.altAnimeNamesAnswers = Array.from(otherAnswers).filter((x) => !song.altAnimeNames.includes(x));
        }
    }
    // official amq song export structure
    else if (typeof data === "object" && data.roomName && data.startTime && data.songs) {
        for (let song of data.songs) {
            finalSongList.push({
                animeRomajiName: song.songInfo.animeNames.romaji,
                animeEnglishName: song.songInfo.animeNames.english,
                altAnimeNames: song.songInfo.altAnimeNames || [song.songInfo.animeNames.romaji, song.songInfo.animeNames.english],
                altAnimeNamesAnswers: song.songInfo.altAnimeNamesAnswers || [],
                songArtist: song.songInfo.artist,
                songName: song.songInfo.songName,
                songType: song.songInfo.type,
                songTypeNumber: song.songInfo.typeNumber,
                songDifficulty: song.songInfo.animeDifficulty,
                animeType: song.songInfo.animeType,
                animeVintage: song.songInfo.vintage,
                annId: song.songInfo.siteIds.annId,
                malId: song.songInfo.siteIds.malId,
                kitsuId: song.songInfo.siteIds.kitsuId,
                aniListId: song.songInfo.siteIds.aniListId,
                animeTags: song.songInfo.animeTags,
                animeGenre: song.songInfo.animeGenre,
                rebroadcast: song.songInfo.rebroadcast || null,
                dub: song.songInfo.dub || null,
                startPoint: song.startPoint,
                audio: String(song.videoUrl).endsWith(".mp3") ? song.videoUrl : null,
                video480: null,
                video720: String(song.videoUrl).endsWith(".webm") ? song.videoUrl : null,
                correctGuess: song.correctGuess,
                incorrectGuess: song.wrongGuess,
            });
        }
    }
    // joseph song export script structure
    else if (Array.isArray(data) && data.length && data[0].gameMode) {
        for (let song of data) {
            finalSongList.push({
                animeRomajiName: song.anime.romaji,
                animeEnglishName: song.anime.english,
                altAnimeNames: song.altAnswers || [song.anime.romaji, song.anime.english],
                altAnimeNamesAnswers: [],
                songArtist: song.artist,
                songName: song.name,
                songType: Object({ O: 1, E: 2, I: 3 })[song.type[0]],
                songTypeNumber: song.type[0] === "I" ? null : parseInt(song.type.split(" ")[1]),
                songDifficulty: parseFloat(song.difficulty),
                animeType: song.animeType,
                animeVintage: song.vintage,
                annId: song.siteIds.annId,
                malId: song.siteIds.malId,
                kitsuId: song.siteIds.kitsuId,
                aniListId: song.siteIds.aniListId,
                animeTags: song.tags,
                animeGenre: song.genre,
                rebroadcast: null,
                dub: null,
                startPoint: song.startSample,
                audio: song.urls?.catbox?.[0] ?? song.urls?.openingsmoe?.[0] ?? null,
                video480: song.urls?.catbox?.[480] ?? song.urls?.openingsmoe?.[480] ?? null,
                video720: song.urls?.catbox?.[720] ?? song.urls?.openingsmoe?.[720] ?? null,
                correctGuess: song.correct,
                incorrectGuess: !song.correct,
            });
        }
    }
    // blissfulyoshi ranked data export structure
    else if (Array.isArray(data) && data.length && data[0].animeRomaji) {
        for (let song of data) {
            finalSongList.push({
                animeRomajiName: song.animeRomaji,
                animeEnglishName: song.animeEng,
                altAnimeNames: [song.animeRomaji, song.animeEng],
                altAnimeNamesAnswers: [],
                songArtist: song.artist,
                songName: song.songName,
                songType: Object({ O: 1, E: 2, I: 3 })[song.type[0]],
                songTypeNumber: song.type[0] === "I" ? null : parseInt(song.type.split(" ")[1]),
                songDifficulty: song.songDifficulty,
                animeType: null,
                animeVintage: song.vintage,
                annId: song.annId,
                malId: song.malId,
                kitsuId: song.kitsuId,
                aniListId: song.aniListId,
                animeTags: song.animeTags,
                animeGenre: song.animeGenres,
                rebroadcast: null,
                dub: null,
                startPoint: null,
                audio: song.LinkMp3,
                video480: null,
                video720: song.LinkVideo,
                correctGuess: true,
                incorrectGuess: true,
            });
        }
    }
    // kempanator answer stats script export structure
    else if (typeof data === "object" && data.songHistory && data.playerInfo) {
        for (let song of Object.values(data.songHistory)) {
            finalSongList.push({
                animeRomajiName: song.animeRomajiName,
                animeEnglishName: song.animeEnglishName,
                altAnimeNames: song.altAnimeNames || [],
                altAnimeNamesAnswers: song.altAnimeNamesAnswers || [],
                songArtist: song.songArtist,
                songName: song.songName,
                songType: song.songType,
                songTypeNumber: song.songTypeNumber,
                songDifficulty: song.songDifficulty,
                animeType: song.animeType,
                animeVintage: song.animeVintage,
                annId: song.annId,
                malId: song.malId,
                kitsuId: song.kitsuId,
                aniListId: song.aniListId,
                animeTags: song.animeTags || [],
                animeGenre: song.animeGenre || [],
                rebroadcast: song.rebroadcast || null,
                dub: song.dub || null,
                startPoint: null,
                audio: song.audio,
                video480: song.video480,
                video720: song.video720,
                correctGuess: true,
                incorrectGuess: true,
            });
        }
    }
    // this script structure
    else if (Array.isArray(data) && data.length && data[0].animeRomajiName) {
        finalSongList = data;
    }
    // Filter out ignored songs
    finalSongList = finalSongList.filter((song) => !ignoredSongs.some((ignoredSong) => ignoredSong.songName === song.songName && ignoredSong.songArtist === song.songArtist && ignoredSong.animeRomajiName === song.animeRomajiName));

    finalSongList = finalSongList.filter((song) => song.audio || song.video480 || song.video720);
}

// create song list table
function createSongListTable(displayList) {
    const showIgnored = $("#cslgShowIgnoredButton").hasClass("active");

    if (showIgnored) {
        displayList = ignoredSongs;
    } else if (isSearchMode) {
        displayList = filterSongList(songList);
    } else {
        displayList = filterSongList(mySongList);
    }

    $("#cslgSongListCount").text("Songs: " + displayList.length);
    $("#cslgMergeCurrentCount").text(`Current song list: ${displayList.length} song${displayList.length === 1 ? "" : "s"}`);
    $("#cslgSongListWarning").text("");
    let $thead = $("#cslgSongListTable thead");
    let $tbody = $("#cslgSongListTable tbody");
    $thead.empty();
    $tbody.empty();

    // Apply sorting
    if (songListTableSort[0] === 1) {
        displayList.sort((a, b) => (a.songName || "").localeCompare(b.songName || ""));
    } else if (songListTableSort[0] === 2) {
        displayList.sort((a, b) => (b.songName || "").localeCompare(a.songName || ""));
    } else if (songListTableSort[1] === 1) {
        displayList.sort((a, b) => (a.songArtist || "").localeCompare(b.songArtist || ""));
    } else if (songListTableSort[1] === 2) {
        displayList.sort((a, b) => (b.songArtist || "").localeCompare(a.songArtist || ""));
    } else if (songListTableSort[2] === 1) {
        displayList.sort((a, b) => a.songDifficulty - b.songDifficulty);
    } else if (songListTableSort[2] === 2) {
        displayList.sort((a, b) => b.songDifficulty - a.songDifficulty);
    } else if (songListTableSort[3] === 1) {
        displayList.sort((a, b) => (options.useRomajiNames ? a.animeRomajiName : a.animeEnglishName).localeCompare(options.useRomajiNames ? b.animeRomajiName : b.animeEnglishName));
    } else if (songListTableSort[3] === 2) {
        displayList.sort((a, b) => (options.useRomajiNames ? b.animeRomajiName : b.animeEnglishName).localeCompare(options.useRomajiNames ? a.animeRomajiName : a.animeEnglishName));
    } else if (songListTableSort[4] === 1) {
        displayList.sort((a, b) => songTypeSortValue(a.songType, a.songTypeNumber) - songTypeSortValue(b.songType, b.songTypeNumber));
    } else if (songListTableSort[4] === 2) {
        displayList.sort((a, b) => songTypeSortValue(b.songType, b.songTypeNumber) - songTypeSortValue(a.songType, a.songTypeNumber));
    } else if (songListTableSort[5] === 1) {
        displayList.sort((a, b) => vintageSortValue(a.animeVintage) - vintageSortValue(b.animeVintage));
    } else if (songListTableSort[5] === 2) {
        displayList.sort((a, b) => vintageSortValue(b.animeVintage) - vintageSortValue(a.animeVintage));
    }

    if (songListTableMode === 0) {
        let $row = $("<tr></tr>");
        $row.append($(`<th class="number">#</th>`));
        $row.append(
            $(`<th class="song clickAble">Song</th>`).click(() => {
                setSongListTableSort(0);
                createSongListTable(displayList);
            })
        );
        $row.append(
            $(`<th class="artist clickAble">Artist</th>`).click(() => {
                setSongListTableSort(1);
                createSongListTable(displayList);
            })
        );
        $row.append(
            $(`<th class="difficulty clickAble">Dif</th>`).click(() => {
                setSongListTableSort(2);
                createSongListTable(displayList);
            })
        );
        $row.append($(`<th class="action"></th>`));
        $thead.append($row);
        displayList.forEach((song, i) => {
            let $row = $("<tr></tr>");
            $row.append(
                $("<td></td>")
                    .addClass("number")
                    .text(i + 1)
            );
            $row.append($("<td></td>").addClass("song").text(song.songName));
            $row.append($("<td></td>").addClass("artist").text(song.songArtist));
            $row.append(
                $("<td></td>")
                    .addClass("difficulty")
                    .text(Number.isFinite(song.songDifficulty) ? Math.floor(song.songDifficulty) : "")
            );
            $row.append(
                $("<td></td>").addClass("action").append(`
                    ${showIgnored ? '<i class="fa fa-check clickAble" aria-hidden="true"></i>' : '<i class="fa fa-plus clickAble" aria-hidden="true"></i>'}
                    <i class="fa fa-trash clickAble" aria-hidden="true"></i>
                    ${showIgnored ? "" : '<i class="fa fa-ban clickAble" aria-hidden="true"></i>'}
                `)
            );
            $tbody.append($row);
        });
    } else if (songListTableMode === 1) {
        let $row = $("<tr></tr>");
        $row.append($(`<th class="number">#</th>`));
        $row.append(
            $(`<th class="anime clickAble">Anime</th>`).click(() => {
                setSongListTableSort(3);
                createSongListTable(displayList);
            })
        );
        $row.append(
            $(`<th class="songType clickAble">Type</th>`).click(() => {
                setSongListTableSort(4);
                createSongListTable(displayList);
            })
        );
        $row.append(
            $(`<th class="vintage clickAble">Vintage</th>`).click(() => {
                setSongListTableSort(5);
                createSongListTable(displayList);
            })
        );
        $row.append($(`<th class="action"></th>`));
        $thead.append($row);
        displayList.forEach((song, i) => {
            let $row = $("<tr></tr>");
            $row.append(
                $("<td></td>")
                    .addClass("number")
                    .text(i + 1)
            );
            $row.append(
                $("<td></td>")
                    .addClass("anime")
                    .text(options.useRomajiNames ? song.animeRomajiName : song.animeEnglishName)
            );
            $row.append($("<td></td>").addClass("songType").text(songTypeText(song.songType, song.songTypeNumber)));
            $row.append($("<td></td>").addClass("vintage").text(song.animeVintage));
            $row.append(
                $("<td></td>").addClass("action").append(`
                    ${showIgnored ? '<i class="fa fa-check clickAble" aria-hidden="true"></i>' : '<i class="fa fa-plus clickAble" aria-hidden="true"></i>'}
                    <i class="fa fa-trash clickAble" aria-hidden="true"></i>
                    ${showIgnored ? "" : '<i class="fa fa-ban clickAble" aria-hidden="true"></i>'}
                `)
            );
            $tbody.append($row);
        });
    } else if (songListTableMode === 2) {
        let $row = $("<tr></tr>");
        $row.append($(`<th class="number">#</th>`));
        $row.append($(`<th class="link clickAble">MP3</th>`));
        $row.append($(`<th class="link clickAble">480</th>`));
        $row.append($(`<th class="link clickAble">720</th>`));
        $row.append($(`<th class="action"></th>`));
        $thead.append($row);
        displayList.forEach((song, i) => {
            let $row = $("<tr></tr>");
            $row.append(
                $("<td></td>")
                    .addClass("number")
                    .text(i + 1)
            );
            $row.append($("<td></td>").addClass("link").append(createLinkElement(song.audio)));
            $row.append($("<td></td>").addClass("link").append(createLinkElement(song.video480)));
            $row.append($("<td></td>").addClass("link").append(createLinkElement(song.video720)));
            $row.append(
                $("<td></td>").addClass("action").append(`
                    ${showIgnored ? "" : '<i class="fa fa-plus clickAble" aria-hidden="true"></i>'}
                    <i class="fa fa-trash clickAble" aria-hidden="true"></i>
                    ${showIgnored ? "" : '<i class="fa fa-ban clickAble" aria-hidden="true"></i>'}
                `)
            );
            $tbody.append($row);
        });
    }
}

function filterSongList(list) {
    if (currentSearchFilter) {
        const searchCriteria = $("#cslgSearchCriteria").val();
        return list.filter((song) => {
            const lowerCaseFilter = currentSearchFilter.toLowerCase();
            switch (searchCriteria) {
                case "songName":
                    return song.songName.toLowerCase().includes(lowerCaseFilter);
                case "songArtist":
                    return song.songArtist.toLowerCase().includes(lowerCaseFilter);
                case "animeName":
                    return song.animeEnglishName.toLowerCase().includes(lowerCaseFilter) || song.animeRomajiName.toLowerCase().includes(lowerCaseFilter);
                case "songType":
                    return songTypeText(song.songType, song.songTypeNumber).toLowerCase().includes(lowerCaseFilter);
                case "animeVintage":
                    return song.animeVintage.toLowerCase().includes(lowerCaseFilter);
                case "all":
                default:
                    return (
                        song.songName.toLowerCase().includes(lowerCaseFilter) ||
                        song.songArtist.toLowerCase().includes(lowerCaseFilter) ||
                        song.animeRomaji.toLowerCase().includes(lowerCaseFilter) ||
                        song.animeEnglishName.toLowerCase().includes(lowerCaseFilter) ||
                        songTypeText(song.songType, song.songTypeNumber).toLowerCase().includes(lowerCaseFilter) ||
                        song.animeVintage.toLowerCase().includes(lowerCaseFilter)
                    );
            }
        });
    }
    return list;
}

// create merged song list table
function createMergedSongListTable() {
    $("#cslgMergedSongListCount").text("Merged: " + mergedSongList.length);
    $("#cslgMergeTotalCount").text(`Merged song list: ${mergedSongList.length} song${mergedSongList.length === 1 ? "" : "s"}`);
    let $tbody = $("#cslgMergedSongListTable tbody");
    $tbody.empty();
    mergedSongList.forEach((song, i) => {
        let $row = $("<tr></tr>");
        $row.append(
            $("<td></td>")
                .addClass("number")
                .text(i + 1)
        );
        $row.append(
            $("<td></td>")
                .addClass("anime")
                .text(options.useRomajiNames ? song.animeRomajiName : song.animeEnglishName)
        );
        $row.append($("<td></td>").addClass("songType").text(songTypeText(song.songType, song.songTypeNumber)));
        $row.append($("<td></td>").addClass("action").append(`<i class="fa fa-chevron-up clickAble" aria-hidden="true"></i><i class="fa fa-chevron-down clickAble" aria-hidden="true"></i> <i class="fa fa-trash clickAble" aria-hidden="true"></i>`));
        $tbody.append($row);
    });
}

// create answer table
function createAnswerTable() {
    let $tbody = $("#cslgAnswerTable tbody");
    $tbody.empty();
    if (finalSongList.length === 0) {
        $("#cslgAnswerText").text("No list loaded");
    } else if (autocomplete.length === 0) {
        $("#cslgAnswerText").text("Fetch autocomplete first");
    } else {
        let animeList = new Set();
        let missingAnimeList = [];
        for (let song of finalSongList) {
            let answers = [song.animeEnglishName, song.animeRomajiName].concat(song.altAnimeNames, song.altAnimeNamesAnswers);
            answers.forEach((x) => animeList.add(x));
        }
        for (let anime of animeList) {
            if (!autocomplete.includes(anime.toLowerCase())) {
                missingAnimeList.push(anime);
            }
        }
        missingAnimeList.sort((a, b) => a.localeCompare(b));
        $("#cslgAnswerText").text(`Found ${missingAnimeList.length} anime missing from AMQ's autocomplete`);
        for (let anime of missingAnimeList) {
            let $row = $("<tr></tr>");
            $row.append($("<td></td>").addClass("oldName").text(anime));
            $row.append(
                $("<td></td>")
                    .addClass("newName")
                    .text(replacedAnswers[anime] || "")
            );
            $row.append($("<td></td>").addClass("edit").append(`<i class="fa fa-pencil clickAble" aria-hidden="true"></i>`));
            $tbody.append($row);
        }
    }
}

// create link element for song list table
function createLinkElement(link) {
    if (!link) return "";
    let $a = $("<a></a>");
    if (link.startsWith("http")) {
        $a.text(link.includes("catbox") ? link.split("/").slice(-1)[0] : link);
        $a.attr("href", link);
    } else if (/^\w+\.\w{3,4}$/.test(link)) {
        $a.text(link);
        if (fileHostOverride) {
            $a.attr("href", "https://" + catboxHostDict[fileHostOverride] + "/" + link);
        } else {
            $a.attr("href", "https://ladist1.catbox.video/" + link);
        }
    }
    $a.attr("target", "_blank");
    return $a;
}

// reset all values in table sort options and toggle specified index
function setSongListTableSort(index) {
    if (Number.isInteger(index)) {
        let value = songListTableSort[index];
        songListTableSort.forEach((x, i) => {
            songListTableSort[i] = 0;
        });
        songListTableSort[index] = value === 1 ? 2 : 1;
    } else {
        songListTableSort.forEach((x, i) => {
            songListTableSort[i] = 0;
        });
    }
}

// get sorting value for anime vintage
function vintageSortValue(vintage) {
    if (!vintage) return 0;
    let split = vintage.split(" ");
    let year = parseInt(split[1]);
    if (isNaN(year)) return 0;
    let season = Object({ Winter: 0.1, Spring: 0.2, Summer: 0.3, Fall: 0.4 })[split[0]];
    if (!season) return 0;
    return year + season;
}

// get sorting value for song type
function songTypeSortValue(type, typeNumber) {
    return (type || 0) * 1000 + (typeNumber || 0);
}

// reset all tabs
function tabReset() {
    $("#cslgSongListTab").removeClass("selected");
    $("#cslgQuizSettingsTab").removeClass("selected");
    $("#cslgAnswerTab").removeClass("selected");
    $("#cslgMergeTab").removeClass("selected");
    $("#cslgHotkeyTab").removeClass("selected");
    $("#cslgListImportTab").removeClass("selected");
    $("#cslgInfoTab").removeClass("selected");
    $("#cslgSongListContainer").hide();
    $("#cslgQuizSettingsContainer").hide();
    $("#cslgAnswerContainer").hide();
    $("#cslgMergeContainer").hide();
    $("#cslgHotkeyContainer").hide();
    $("#cslgListImportContainer").hide();
    $("#cslgInfoContainer").hide();
}

// convert full url to target data
function formatTargetUrl(url) {
    if (url && url.startsWith("http")) {
        return url.split("/").slice(-1)[0];
    }
    return url;
}

// translate type and typeNumber ids to shortened type text
function songTypeText(type, typeNumber) {
    if (type === 1) return "OP" + typeNumber;
    if (type === 2) return "ED" + typeNumber;
    if (type === 3) return "IN";
    return "";
}

// input 3 links, return formatted catbox link object
function createCatboxLinkObject(audio, video480, video720) {
    let links = {};
    console.log("audio : ", audio);
    console.log("video480 : ", video480);
    console.log("video720 : ", video720);
    if (fileHostOverride) {
        if (audio) links["0"] = "https://" + catboxHostDict[fileHostOverride] + "/" + audio.split("/").slice(-1)[0];
        if (video480) links["480"] = "https://" + catboxHostDict[fileHostOverride] + "/" + video480.split("/").slice(-1)[0];
        if (video720) links["720"] = "https://" + catboxHostDict[fileHostOverride] + "/" + video720.split("/").slice(-1)[0];
    } else {
        if (audio) links["0"] = audio;
        if (video480) links["480"] = video480;
        if (video720) links["720"] = video720;
    }
    return links;
}

// create hotkey element
function createHotkeyElement(title, key, selectID, inputID) {
    let $select = $(`<select id="${selectID}" style="padding: 3px 0;"></select>`).append(`<option>ALT</option>`).append(`<option>CTRL</option>`).append(`<option>CTRL ALT</option>`).append(`<option>-</option>`);
    let $input = $(`<input id="${inputID}" type="text" maxlength="1" style="width: 40px;">`).val(hotKeys[key].key);
    $select.on("change", () => {
        hotKeys[key] = {
            altKey: $select.val().includes("ALT"),
            ctrlKey: $select.val().includes("CTRL"),
            key: $input.val().toLowerCase(),
        };
        saveSettings();
    });
    $input.on("change", () => {
        hotKeys[key] = {
            altKey: $select.val().includes("ALT"),
            ctrlKey: $select.val().includes("CTRL"),
            key: $input.val().toLowerCase(),
        };
        saveSettings();
    });
    if (hotKeys[key].altKey && hotKeys[key].ctrlKey) $select.val("CTRL ALT");
    else if (hotKeys[key].altKey) $select.val("ALT");
    else if (hotKeys[key].ctrlKey) $select.val("CTRL");
    else $select.val("-");
    $("#cslgHotkeyTable tbody").append($(`<tr></tr>`).append($(`<td></td>`).text(title)).append($(`<td></td>`).append($select)).append($(`<td></td>`).append($input)));
}

// test hotkey
function testHotkey(action, key, altKey, ctrlKey) {
    let hotkey = hotKeys[action];
    return key === hotkey.key && altKey === hotkey.altKey && ctrlKey === hotkey.ctrlKey;
}

// return true if you are in a ranked lobby or quiz
function isRankedMode() {
    return (lobby.inLobby && lobby.settings.gameMode === "Ranked") || (quiz.inQuiz && quiz.gameMode === "Ranked");
}

// safeguard against people putting valid javascript in the song json
function preventCodeInjection(text) {
    if (/<script/i.test(text)) {
        cslMessage("⚠️ code injection attempt detected, ending quiz");
        quizOver();
        console.warn("CSL CODE INJECTION ATTEMPT:\n" + text);
        return "";
    }
    return text;
}

// split a string into chunks
function splitIntoChunks(str, chunkSize) {
    let chunks = [];
    for (let i = 0; i < str.length; i += chunkSize) {
        chunks.push(str.slice(i, i + chunkSize));
    }
    return chunks;
}

// convert base 10 number to base 36
function base10to36(number) {
    if (number === 0) return 0;
    let digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    let result = "";
    while (number > 0) {
        let remainder = number % 36;
        result = digits[remainder] + result;
        number = Math.floor(number / 36);
    }
    return result;
}

// convert base 36 number to base 10
function base36to10(number) {
    number = String(number);
    let digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    let result = 0;
    for (let i = 0; i < number.length; i++) {
        let digit = digits.indexOf(number[i]);
        if (digit === -1) return null;
        result = result * 36 + digit;
    }
    return result;
}

// manage data for split messages
class Chunk {
    constructor() {
        this.chunkMap = {};
        this.isComplete = false;
    }
    append(text) {
        let regex = /^§CSL\w(\w)/.exec(text);
        if (regex) {
            let index = base36to10(regex[1]);
            if (text.endsWith("$")) {
                this.chunkMap[index] = text.slice(6, -1);
                this.isComplete = true;
            } else {
                this.chunkMap[index] = text.slice(6);
            }
        } else {
            console.log("CSL ERROR: bad chunk\n" + text);
        }
    }
    decode() {
        if (this.isComplete) {
            let result = Object.values(this.chunkMap).reduce((a, b) => a + b);
            try {
                return decodeURIComponent(atob(result));
            } catch {
                sendSystemMessage("CSL chunk decode error");
                console.log("CSL ERROR: could not decode\n" + result);
            }
        } else {
            sendSystemMessage("CSL incomplete chunk");
            console.log("CSL ERROR: incomplete chunk\n", this.chunkMap);
        }
        return "";
    }
}

// input myanimelist username, return list of mal ids
async function getMalIdsFromMyanimelist(username) {
    let malIds = [];
    let statuses = [];
    if ($("#cslgListImportWatchingCheckbox").prop("checked")) {
        statuses.push("watching");
    }
    if ($("#cslgListImportCompletedCheckbox").prop("checked")) {
        statuses.push("completed");
    }
    if ($("#cslgListImportHoldCheckbox").prop("checked")) {
        statuses.push("on_hold");
    }
    if ($("#cslgListImportDroppedCheckbox").prop("checked")) {
        statuses.push("dropped");
    }
    if ($("#cslgListImportPlanningCheckbox").prop("checked")) {
        statuses.push("plan_to_watch");
    }
    for (let status of statuses) {
        $("#cslgListImportText").text(`Retrieving Myanimelist: ${status}`);
        let nextPage = `https://api.myanimelist.net/v2/users/${username}/animelist?offset=0&limit=1000&nsfw=true&status=${status}`;
        while (nextPage) {
            let result = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: nextPage,
                    headers: { "Content-Type": "application/json", Accept: "application/json", "X-MAL-CLIENT-ID": malClientId },
                    onload: (res) => resolve(JSON.parse(res.response)),
                    onerror: (res) => reject(res),
                });
            });
            if (result.error) {
                nextPage = false;
                $("#cslgListImportText").text(`MAL API Error: ${result.error}`);
            } else {
                for (let anime of result.data) {
                    console.log("anime data", anime);
                     const malIdEntry = {
                         malId: anime.nodeId,
                     };
                    malIds.push(malIdEntry);
                }
                nextPage = result.paging.next;
            }
        }
    }
    return malIds;
}

// input anilist username, return list of mal ids
async function getMalIdsFromAnilist(username) {
    let pageNumber = 1;
    let malIds = [];
    let statuses = [];
    if ($("#cslgListImportWatchingCheckbox").prop("checked")) {
        statuses.push("CURRENT");
    }
    if ($("#cslgListImportCompletedCheckbox").prop("checked")) {
        statuses.push("COMPLETED");
    }
    if ($("#cslgListImportHoldCheckbox").prop("checked")) {
        statuses.push("PAUSED");
    }
    if ($("#cslgListImportDroppedCheckbox").prop("checked")) {
        statuses.push("DROPPED");
    }
    if ($("#cslgListImportPlanningCheckbox").prop("checked")) {
        statuses.push("PLANNING");
    }
    $("#cslgListImportText").text(`Retrieving Anilist: ${statuses}`);
    let hasNextPage = true;
    while (hasNextPage) {
        let data = await getAnilistData(username, statuses, pageNumber);
        if (data) {
            for (let item of data.mediaList) {
                if (item.media.idMal) {
                     const malIdEntry = {
                         malId: item.media.idMal,
                         genres: item.media.genres,
                         tags: item.media.tags.map(tag => tag.name), // Extracting tag names
                         rating: (item.media.averageScore/10).toFixed(1)
                     };
                    malIds.push(malIdEntry);
                }
            }
            if (data.pageInfo.hasNextPage) {
                pageNumber += 1;
            } else {
                hasNextPage = false;
            }
        } else {
            $("#cslgListImportText").text("Anilist API Error");
            hasNextPage = false;
        }
    }
    return malIds;
}

// input username, status, and page number
function getAnilistData(username, statuses, pageNumber) {
    let query = `
        query {
            Page (page: ${pageNumber}, perPage: 50) {
                pageInfo {
                    currentPage
                    hasNextPage
                }
                mediaList (userName: "${username}", type: ANIME, status_in: [${statuses}]) {
                    status
                    media {
                        id
                        idMal
                        genres
                        tags{
                          name
                        }
                        averageScore
                    }
                }
            }
        }
    `;
    let data = {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: query }),
    };
    return fetch("https://graphql.anilist.co", data)
        .then((res) => res.json())
        .then((json) => json?.data?.Page)
        .catch((error) => console.log(error));
}

async function getSongListFromMalIds(malIds) {
    if (!malIds) malIds = [];
    importedSongList = [];
    $("#cslgListImportText").text(`Anime: 0 / ${malIds.length} | Songs: ${importedSongList.length}`);
    if (malIds.length === 0) return;
    let url = "https://anisongdb.com/api/malIDs_request";
    let idsProcessed = 0;
    console.log("malIds: ", malIds);
    for (let i = 0; i < malIds.length; i += 500) {
        let segment = malIds.slice(i, i + 500);
        idsProcessed += segment.length;
        // Extract only the malId from each entry in the segment
        let malIdSegment = segment.map(item => item.malId);
        let data = {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ malIds: malIdSegment }),
        };
        await fetch(url, data)
            .then((res) => res.json())
            .then((json) => {
                if (Array.isArray(json)) {
                     for (let anime of json) {
                         // Assuming anime is structured correctly to find the right item
                         const animeIndex = segment.findIndex(item => item.malId === anime.linked_ids.myanimelist);
                         if (animeIndex !== -1) {
                             let songType = anime.songType;
                             // Check and set the songType and typeNumber
                             if (songType.startsWith("Opening")) {
                                 anime.songType = 1;
                                 anime.typeNumber = parseInt(songType.replace(/\D/g, '')); // Extract the number
                             } else if (songType.startsWith("Ending")) {
                                 anime.songType = 2;
                                 anime.typeNumber = parseInt(songType.replace(/\D/g, ''));
                             } else if (songType === "Insert Song") {
                                 anime.songType = 3;
                                 anime.typeNumber = null; // No type number for Insert Song
                             }
                             anime.animeRomajiName = anime.animeJPName;
                             anime.animeEnglishName = anime.animeENName;
                             anime.video480 = anime.MQ;
                             anime.video720 = anime.HQ;
                             anime.altAnimeNames = [].concat(anime.animeJPName, anime.animeENName, anime.animeAltName || []);
                             anime.altAnimeNamesAnswers = [];
                             anime.annId = anime.annId;
                             anime.malId = anime.linked_ids?.myanimelist;
                             anime.kitsuId =  anime.linked_ids?.kitsu;
                             anime.aniListId = anime.linked_ids?.anilist;
                             // Enrich the anime data with genres and tags
                             importedSongList.push({
                                 ...anime, // Spread the existing anime data
                                 animeGenre: segment[animeIndex].genres, // Use the genres from malIds
                                 animeTags: segment[animeIndex].tags, // Use the tags from malIds
                                 rating: segment[animeIndex].rating,
                             });
                         }
                     }
                    $("#cslgListImportText").text(`Anime: ${idsProcessed} / ${malIds.length} | Songs: ${importedSongList.length}`);
                } else {
                    $("#cslgListImportText").text("anisongdb error");
                    console.log(json);
                    throw new Error("did not receive an array from anisongdb");
                }
            })
            .catch((res) => {
                importedSongList = [];
                $("#cslgListImportText").text("anisongdb error");
                console.log(res);
            });
    }
}

// start list import process
async function startImport() {
    if (importRunning) return;
    importRunning = true;
    $("#cslgListImportStartButton").addClass("disabled");
    $("#cslgListImportActionContainer").hide();
    if ($("#cslgListImportSelect").val() === "myanimelist") {
        if (malClientId) {
            let username = $("#cslgListImportUsernameInput").val().trim();
            if (username) {
                let malIds = await getMalIdsFromMyanimelist(username);
                console.log("mailIds : ", malIds);
                await getSongListFromMalIds(malIds);

            } else {
                $("#cslgListImportText").text("Input Myanimelist Username");
            }
        } else {
            $("#cslgListImportText").text("Missing MAL Client ID");
        }
    } else if ($("#cslgListImportSelect").val() === "anilist") {
        let username = $("#cslgListImportUsernameInput").val().trim();
        if (username) {
            let malIds = await getMalIdsFromAnilist(username);
            await getSongListFromMalIds(malIds);
        } else {
            $("#cslgListImportText").text("Input Anilist Username");
        }
    }
    if (importedSongList.length) {
        $("#cslgListImportActionContainer").show();
        $("#cslgListImportMoveButton")
            .off("click")
            .on("click", function () {
                mySongList = importedSongList;
                isSearchMode = false;
                $("#cslgToggleModeButton").text("My Songs");
                updateSongListDisplay();
                createAnswerTable();
                $("#cslgListImportActionContainer").hide();
                gameChat.systemMessage(`Imported ${mySongList.length} songs to My Songs list.`);
            });
        $("#cslgListImportDownloadButton")
            .off("click")
            .on("click", function () {
                if (!importedSongList.length) return;
                let listType = $("#cslgListImportSelect").val();
                let username = $("#cslgListImportUsernameInput").val().trim();
                let date = new Date();
                let dateFormatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, 0)}-${String(date.getDate()).padStart(2, 0)}`;
                let data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(importedSongList));
                let element = document.createElement("a");
                element.setAttribute("href", data);
                element.setAttribute("download", `${username} ${listType} ${dateFormatted} song list.json`);
                document.body.appendChild(element);
                element.click();
                element.remove();
            });
    }
    $("#cslgListImportStartButton").removeClass("disabled");
    importRunning = false;
}

// validate json data in local storage
function validateLocalStorage(item) {
    try {
        return JSON.parse(localStorage.getItem(item)) || {};
    } catch {
        return {};
    }
}

function applyStyles() {
    $("#customSongListStyle").remove();
    let tableHighlightColor = getComputedStyle(document.documentElement).getPropertyValue("--accentColorContrast") || "#4497ea";
    let style = document.createElement("style");
    style.type = "text/css";
    style.id = "customSongListStyle";
    let text = `

    input.number-to-text::-webkit-outer-spin-button,
    input.number-to-text::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    input[type=number].number-to-text {
        -moz-appearance: textfield;
    }

	.close {
    position: absolute;
    right: 15px;
    top: 10px;
	}

	.modal-header {
    position: relative;
	}

	.modal-header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    margin-bottom: 10px;
	}

	.modal-title {
		flex-grow: 1;
		text-align: center;
		margin: 0;
	}

	.training-info-link {
		font-size: 0.9em;
		cursor: pointer;
		color: #4a90e2; /* Warmer blue color */
		position: absolute;
		left: 15px;
		top: 10px;
	}

	.training-info-link:hover {
		text-decoration: underline;
		color: #3a7bd5; /* Slightly darker on hover */
	}

	.cslg-search,
	.cslg-anisongdb-search {
		display: flex;
		align-items: center;
		width: 100%;
	}

	#cslgSearchCriteria,
	#cslgAnisongdbModeSelect {
		width: 120px;
		flex-shrink: 0;
	}

	#cslgSearchInput,
	#cslgAnisongdbQueryInput {
		flex-grow: 1;
		margin: 0 10px;
	}

	#cslgAnisongdbSearchButtonGo {
		flex-shrink: 0;
	}

    .btn-group-sm>.btn, .btn-sm {
        padding: 3px 8px;
        font-size: 13px;
        line-height: 1.5;
        border-radius: 3px;
    }

    #cslgToggleModeButton, #cslgFileUpload {
        padding: 2px 10px;
        font-size: 14px;
    }

    #lnCustomSongListButton, #lnStatsButton {
        left: calc(25%);
        width: 80px;
    }

    #lnStatsButton {
        left: calc(25% + 90px);
    }

    #cslgSongListContainer input[type="radio"],
    #cslgSongListContainer input[type="checkbox"],
    #cslgQuizSettingsContainer input[type="checkbox"],
    #cslgQuizSettingsContainer input[type="radio"],
    #cslgListImportContainer input[type="checkbox"] {
        width: 20px;
        height: 20px;
        margin-left: 3px;
        vertical-align: -5px;
        cursor: pointer;
    }

    #cslgSongListTable, #cslgMergedSongListTable {
        width: 100%;
        table-layout: fixed;
    }

    #cslgSongListTable thead tr, #cslgMergedSongListTable thead tr {
        font-weight: bold;
    }

    #cslgSongListTable .number, #cslgMergedSongListTable .number {
        width: 30px;
    }

    #cslgSongListTable .difficulty {
        width: 30px;
    }

    #cslgSongListTable .songType, #cslgMergedSongListTable .songType {
        width: 45px;
    }

    #cslgSongListTable .vintage {
        width: 100px;
    }

    #cslgSongListTable .action {
        width: 50px;
    }

    #cslgMergedSongListTable .action {
        width: 55px;
    }

    .btn.focus, .btn:focus, .btn:hover {
    color: white;
    }

    #cslgSongListTable .action i.fa-plus:hover,
    #cslgSongListTable .action i.fa-check:hover {
        color: #5cb85c;
    }

    #cslgSongListTable .action i.fa-trash:hover,
    #cslgMergedSongListTable .action i.fa-trash:hover {
        color: #d9534f;
    }

    #cslgSongListTable .action i.fa-ban:hover {
        color: #f0ad4e;
    }

    #cslgMergedSongListTable .action i.fa-chevron-up:hover,
    #cslgMergedSongListTable .action i.fa-chevron-down:hover {
        color: #f0ad4e;
    }

    #cslgSongListTable th, #cslgSongListTable td,
    #cslgMergedSongListTable th, #cslgMergedSongListTable td {
        padding: 0 4px;
    }

    #cslgSongListTable tr.selected td:not(.action),
    #cslgMergedSongListTable tr.selected td:not(.action) {
        color: ${tableHighlightColor};
    }

/* Adjust the header row layout */
.cslg-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

/* Ensure consistent spacing */
.cslg-header-row > div {
    margin-right: 15px;
}

.cslg-header-row > div:last-child {
    margin-right: 0;
}

    .cslg-mode-selector,
    .cslg-file-upload,
    .cslg-actions,
    .cslg-search,
    .cslg-counts,
    .cslg-anisongdb-search,
    .cslg-options,
    .cslg-advanced-options,
    .cslg-show-ignored {
        display: flex;
        align-items: center;
    }

	.cslg-counts {
		white-space: nowrap;
		margin-left: 10px;
	}

    .cslg-search select,
    .cslg-search input,
    .cslg-anisongdb-search select,
    .cslg-anisongdb-search input {
        margin-right: 5px;
    }

    #songOptionsButton {
    background-color: rgba(73, 80, 87, 1)
    }

    #cslgShowIgnoredButton {
    background-color: rgba(73, 80, 87, 1)
    }

    .form-control-sm {
        height: 25px;
        padding: 2px 5px;
        font-size: 12px;
        line-height: 1.5;
    }

    .dark-theme .form-control {
        color: #f8f9fa;
        background-color: rgba(73, 80, 87, 0.7);
        border-color: #6c757d;
    }

    .cslg-advanced-options .input-group {
        width: auto;
        margin-right: 10px;
    }

    .cslg-advanced-options .input-group-text {
        padding: 2px 5px;
        font-size: 12px;
    }

    .cslg-advanced-options input[type="number"] {
        width: 50px;
    }

    #cslgShowIgnoredButton {
        font-size: 12px;
        padding: 2px 8px;
    }

    .cslg-options {
    	margin-left: 10px;
    }

    .cslg-settings-section {
        background-color: rgba(0, 0, 0, 0.2);
        border-radius: 5px;
        padding: 15px;
        margin-bottom: 20px;
    }

    .cslg-settings-section h3 {
        margin-top: 0;
        margin-bottom: 15px;
        font-size: 18px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        padding-bottom: 5px;
    }

    .cslg-setting-row {
        display: flex;
        align-items: center;
        margin-bottom: 10px;
    }

    .cslg-setting-row input[type="number"],
    .cslg-setting-row input[type="text"],
    .cslg-setting-row select {
        flex: 0 0 100px;
        margin-right: 10px;
        color: black;
    }

    .cslg-checkbox-group {
        display: flex;
        flex-wrap: wrap;
    }

    .cslg-checkbox-group label {
        margin-right: 15px;
        display: flex;
        align-items: center;
    }

    .cslg-checkbox-group input[type="checkbox"] {
        margin-right: 5px;
    }

    .fa-info-circle {
        cursor: pointer;
        margin-left: 5px;
    }

    .song-options-popup {
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 300px;
        background-color: #1a1a1a;
        border: 1px solid #495057;
        border-radius: 6px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        z-index: 10000;
        padding: 20px;
        color: #f8f9fa;
    }

    .song-options-popup.show {
        display: block;
    }

    .song-options-backdrop {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.5);
        z-index: 9999;
    }

    .song-options-backdrop.show {
        display: block;
    }

    .song-options-popup h6 {
        font-size: 1.1em;
        margin-top: 15px;
        margin-bottom: 10px;
        color: #adb5bd;
        border-bottom: 1px solid #495057;
        padding-bottom: 5px;
    }

    .song-options-popup .checkbox-group {
        display: flex;
        flex-direction: column;
        margin-bottom: 15px;
    }

    .song-options-popup .checkbox-group label {
        display: flex;
        align-items: center;
        margin-bottom: 8px;
        color: #f8f9fa;
    }

    .song-options-popup .checkbox-group input[type="checkbox"] {
        margin-right: 10px;
    }

    .song-options-close {
        position: absolute;
        top: 10px;
        right: 10px;
        font-size: 1.5em;
        color: #adb5bd;
        cursor: pointer;
    }

    .song-options-close:hover {
        color: #fff;
    }

	.cslg-mode-selector {
    display: flex;
    align-items: center;
}

.cslg-mode-selector .btn {
    margin-right: 10px;
}

.cslg-actions {
    display: flex;
    align-items: center;
}

.btn-icon {
    background: none;
    border: none;
    color: white;
    font-size: 1.5em;
    padding: 5px;
    margin: 0 5px;
    cursor: pointer;
}

.btn-icon:hover {
    opacity: 0.8;
}

.anisongdb-search-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

/* Add this to your existing styles */
.cslg-header-row.anisongdb-search-row {
    display: flex;
}

body:not(.song-search-mode) .cslg-header-row.anisongdb-search-row {
    display: none;
}

 .stats-section {
   margin-bottom: 20px;
 }
 .stats-section h3 {
   margin-bottom: 10px;
 }
 .stats-table {
   width: 100%;
   border-collapse: collapse;
 }
 .stats-table th, .stats-table td {
   border: 1px solid #ddd;
   padding: 8px;
   text-align: left;
 }
 .stats-table th {
   background-color: #282828;
   color: white;
 }
 .stats-table td {
   background-color: #424242;
   color: #ffffff;
 }
 .stats-table tr:nth-child(even) td {
   background-color: #353535;
 }
    `;
    style.appendChild(document.createTextNode(text));
    document.head.appendChild(style);
    $("#customSongListStyle").append(`
        #cslgSearchCriteria {
            color: white;
            padding: 3px;
            margin-right: 10px;
        }
    `);
}
