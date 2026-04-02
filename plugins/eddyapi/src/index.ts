import type { LunaUnload } from "@luna/core";
import { redux, MediaItem, PlayState } from "@luna/lib";

import { getCurrentReduxTime } from "./time";
import { startServer, stopServer, updateMediaInfo } from "./serveApi.native";

export const unloads = new Set<LunaUnload>();

interface MediaInfo {
  /// the current track
  item: any | null;
  /// the playhead position in seconds
  position: number | null;
  /// the duration of the current track in seconds
  duration: number | null;
  /// an art URL for the current track's album
  albumArt: string | null;
  /// an art URL for the current track's artist
  artistArt: string | null;
  /// is the player paused
  paused: boolean;
  lastUpdate: number;
}

interface UpdateInfo {
  track?: MediaItem;
  time?: number;
  paused?: boolean;
}

let currentInfo: MediaInfo | null = null;
let server = null;

const getMediaURL = (id?: string, path = "/1280x1280.jpg") =>
  id
    ? "https://resources.tidal.com/images/" + id.split("-").join("/") + path
    : null;

export const update = async (info?: UpdateInfo) => {
  if (!info) {
    return;
  }

  if (!currentInfo) {
    currentInfo = {
      item: null,
      position: 0,
      duration: null,
      albumArt: null,
      artistArt: null,
      paused: false,
      lastUpdate: Date.now(),
    };
  }

  if (info.track) {
    currentInfo.item = info.track.tidalItem;
    console.log("Track changed:", currentInfo.item);
    const track = currentInfo.item;
    currentInfo.albumArt = (await info.track.coverUrl()) || null;
    currentInfo.artistArt =
      track.artist && track.artist.picture
        ? getMediaURL(track.artist.picture, "/320x320.jpg")
        : null;

    currentInfo.duration = track.duration;
  }

  // Handle time and paused state updates (from polling)
  if (info.time !== undefined) {
    currentInfo.position = info.time;
    currentInfo.lastUpdate = Date.now();
  }

  if (info.paused !== undefined) {
    currentInfo.paused = info.paused;
  }

  console.log("Current playback state:", currentInfo);

  // Ensure we have some minimal info before sending
  if (currentInfo.item || currentInfo.position !== null) {
    console.log("Sending update");
    updateMediaInfo(currentInfo);
  } else {
    console.log("Not enough info to send update.");
  }
};

// forever
(() => {
  console.log(redux);
  const printPlayTime = async () => {
    let info = {
      time: !PlayState.playing
        ? redux.store.getState().playbackControls.latestCurrentTime
        : getCurrentReduxTime(),
      paused: !PlayState.playing,
    };
    update(info);
    // wait for 1 second
    let t = setTimeout(printPlayTime, 1000);
    unloads.add(() => clearTimeout(t));
  };
  printPlayTime();
})();

MediaItem.onMediaTransition(unloads, async (mediaItem) => {
  console.log("Media transitioned to " + (await mediaItem.title()));
  update({
    track: mediaItem,
  });
});

PlayState.onState(unloads, (state) => {
  console.log("Play state changed to " + state);
  update({
    paused: state !== "PLAYING",
  });
});
console.log(MediaItem);

export const onLoad = () => {
  console.log("Loading EddyAPI on port " + 3665);
  console.log("Secure mode " + "disabled.");
  try {
    server = startServer({
      port: 3665,
      secure: false,
      apiKey: undefined,
    });
    console.log("EddyAPI started");
    unloads.add(() => stopServer());
    unloads.add(() => {
      stopServer();
    });

    // finally, init the media info store
    const initStore = async () => {
      const item = await MediaItem.fromPlaybackContext();
      update({
        track: item,
      });
      console.log("Initial media info:", item);
    };
    initStore();
  } catch (error) {
    console.error("Failed to start EddyAPI:", error);
  }
};

onLoad();
