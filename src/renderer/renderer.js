(() => {
  const nekoEl = document.getElementById("oneko");
  if (!nekoEl || !window.oneko) return;

  const nekoSpeed = 10;
  const spriteSets = {
    idle: [[-3, -3]],
    alert: [[-7, -3]],
    scratchSelf: [
      [-5, 0],
      [-6, 0],
      [-7, 0],
    ],
    scratchWallN: [
      [0, 0],
      [0, -1],
    ],
    scratchWallS: [
      [-7, -1],
      [-6, -2],
    ],
    scratchWallE: [
      [-2, -2],
      [-2, -3],
    ],
    scratchWallW: [
      [-4, 0],
      [-4, -1],
    ],
    tired: [[-3, -2]],
    sleeping: [
      [-2, 0],
      [-2, -1],
    ],
    N: [
      [-1, -2],
      [-1, -3],
    ],
    NE: [
      [0, -2],
      [0, -3],
    ],
    E: [
      [-3, 0],
      [-3, -1],
    ],
    SE: [
      [-5, -1],
      [-5, -2],
    ],
    S: [
      [-6, -3],
      [-7, -2],
    ],
    SW: [
      [-5, -3],
      [-6, -1],
    ],
    W: [
      [-4, -2],
      [-4, -3],
    ],
    NW: [
      [-1, 0],
      [-1, -1],
    ],
  };

  let displays = [];
  let primaryDisplayId = null;
  let virtualBounds = { x: 0, y: 0, width: 800, height: 600 };
  let nekoPosX = 32;
  let nekoPosY = 32;
  let mousePosX = 0;
  let mousePosY = 0;
  let frameCount = 0;
  let idleTime = 0;
  let idleAnimation = null;
  let idleAnimationFrame = 0;
  let mode = "follow";
  let grabbing = false;
  let grabStop = true;
  let nudge = false;
  let kuroNeko = false;
  let variant = "classic";
  let grabTimeout = null;
  let lastNonSleepMode = "follow";
  let roamInfo = null;
  let roamTarget = null;
  let roamDwell = 0;
  let roamPending = false;

  function getPrimaryBounds() {
    const primary = displays.find((display) => display.id === primaryDisplayId) || displays[0];
    return primary ? primary.bounds : { x: 0, y: 0, width: 800, height: 600 };
  }

  function computeVirtualBounds() {
    if (!displays.length) {
      return { x: 0, y: 0, width: 800, height: 600 };
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const display of displays) {
      const b = display.bounds;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  function applyDisplayInfo(info) {
    if (!info || !Array.isArray(info.displays) || info.displays.length === 0) {
      return;
    }
    displays = info.displays;
    if (typeof info.primaryId === "number") {
      primaryDisplayId = info.primaryId;
    }
    virtualBounds = computeVirtualBounds();
  }

  function getDisplayForPoint(x, y) {
    if (!displays.length) return null;

    for (const display of displays) {
      const b = display.bounds;
      const insideX = x >= b.x && x <= b.x + b.width;
      const insideY = y >= b.y && y <= b.y + b.height;
      if (insideX && insideY) {
        return display;
      }
    }

    let closest = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const display of displays) {
      const b = display.bounds;
      const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
      const dy = Math.max(b.y - y, 0, y - (b.y + b.height));
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = display;
      }
    }
    return closest;
  }

  function isPointInAnyDisplay(x, y) {
    for (const display of displays) {
      const b = display.bounds;
      const insideX = x >= b.x && x <= b.x + b.width;
      const insideY = y >= b.y && y <= b.y + b.height;
      if (insideX && insideY) {
        return true;
      }
    }
    return false;
  }

  function getActiveBounds() {
    const display = getDisplayForPoint(nekoPosX, nekoPosY);
    return display ? display.bounds : getPrimaryBounds();
  }

  function getSprite(name, frame) {
    return spriteSets[name][frame % spriteSets[name].length];
  }

  function setSprite(name, frame) {
    const sprite = getSprite(name, frame);
    nekoEl.style.backgroundPosition = `${sprite[0] * 32}px ${sprite[1] * 32}px`;
  }

  function resetIdleAnimation() {
    idleAnimation = null;
    idleAnimationFrame = 0;
  }

  function applyVariant(nextVariant) {
    if (!nextVariant) return;
    variant = nextVariant;
    const assetUrl = new URL(`../../assets/oneko/oneko-${variant}.gif`, window.location.href);
    nekoEl.style.backgroundImage = `url('${assetUrl}')`;
  }

  function applyKuroNeko(next) {
    kuroNeko = Boolean(next);
    nekoEl.style.filter = kuroNeko ? "invert(100%)" : "none";
  }

  function isSleepMode() {
    return mode === "sleep";
  }

  function isTaskbarRoamMode() {
    return mode === "taskbar";
  }

  function applyMode(nextMode) {
    if (!nextMode) return;
    mode = nextMode;
    if (mode !== "sleep") {
      lastNonSleepMode = mode;
    }
    if (isTaskbarRoamMode()) {
      refreshTaskbarRoam();
    } else {
      roamInfo = null;
      roamTarget = null;
      roamDwell = 0;
    }
    if (isSleepMode()) {
      nudge = false;
      goToSleep();
    } else {
      resetIdleAnimation();
    }
  }

  function clampToDesktop() {
    const minX = virtualBounds.x + 16;
    const maxX = virtualBounds.x + virtualBounds.width - 16;
    const minY = virtualBounds.y + 16;
    const maxY = virtualBounds.y + virtualBounds.height - 16;

    nekoPosX = Math.min(Math.max(minX, nekoPosX), maxX);
    nekoPosY = Math.min(Math.max(minY, nekoPosY), maxY);

    if (!isPointInAnyDisplay(nekoPosX, nekoPosY)) {
      const display = getDisplayForPoint(nekoPosX, nekoPosY);
      if (display) {
        const bounds = display.bounds;
        const displayMinX = bounds.x + 16;
        const displayMaxX = bounds.x + bounds.width - 16;
        const displayMinY = bounds.y + 16;
        const displayMaxY = bounds.y + bounds.height - 16;
        nekoPosX = Math.min(Math.max(displayMinX, nekoPosX), displayMaxX);
        nekoPosY = Math.min(Math.max(displayMinY, nekoPosY), displayMaxY);
      }
    }
  }

  function updateWindowPosition() {
    window.oneko.setPosition(nekoPosX, nekoPosY);
  }

  function pickRoamTarget() {
    if (!roamInfo) return;
    const range = Math.max(roamInfo.max - roamInfo.min, 1);
    const offset = roamInfo.min + Math.random() * range;
    if (roamInfo.axis === "x") {
      roamTarget = { x: offset, y: roamInfo.fixed };
    } else {
      roamTarget = { x: roamInfo.fixed, y: offset };
    }
    mousePosX = roamTarget.x;
    mousePosY = roamTarget.y;
    roamDwell = 0;
  }

  async function refreshTaskbarRoam() {
    if (!isTaskbarRoamMode() || roamPending) return;
    roamPending = true;
    try {
      roamInfo = await window.oneko.getTaskbarRoam({ x: nekoPosX, y: nekoPosY });
      if (roamInfo) {
        pickRoamTarget();
      }
    } finally {
      roamPending = false;
    }
  }

  async function goToSleep() {
    const target = await window.oneko.getSleepTarget({ x: nekoPosX, y: nekoPosY });
    mousePosX = target.x;
    mousePosY = target.y;
  }

  function idle() {
    idleTime += 1;

    const idlePickRoll = isTaskbarRoamMode() ? 40 : 200;
    const idleMinFrames = isTaskbarRoamMode() ? 3 : 10;

    if (idleTime > idleMinFrames && Math.floor(Math.random() * idlePickRoll) === 0 && idleAnimation == null) {
      const availableIdleAnimations = ["sleeping", "scratchSelf"];
      if (isTaskbarRoamMode()) {
        availableIdleAnimations.push("tired", "alert");
      }
      const bounds = getActiveBounds();
      if (nekoPosX < bounds.x + 32) {
        availableIdleAnimations.push("scratchWallW");
      }
      if (nekoPosY < bounds.y + 32) {
        availableIdleAnimations.push("scratchWallN");
      }
      if (nekoPosX > bounds.x + bounds.width - 32) {
        availableIdleAnimations.push("scratchWallE");
      }
      if (nekoPosY > bounds.y + bounds.height - 32) {
        availableIdleAnimations.push("scratchWallS");
      }
      if (isTaskbarRoamMode() && roamInfo && roamInfo.edge) {
        if (roamInfo.edge === "top") {
          availableIdleAnimations.push("scratchWallN");
        } else if (roamInfo.edge === "bottom") {
          availableIdleAnimations.push("scratchWallS");
        } else if (roamInfo.edge === "left") {
          availableIdleAnimations.push("scratchWallW");
        } else if (roamInfo.edge === "right") {
          availableIdleAnimations.push("scratchWallE");
        }
      }
      idleAnimation = availableIdleAnimations[Math.floor(Math.random() * availableIdleAnimations.length)];
    }

    if (isSleepMode()) {
      idleAnimation = "sleeping";
    }

    switch (idleAnimation) {
      case "sleeping":
        if (idleAnimationFrame < 8 && nudge && isSleepMode()) {
          setSprite("idle", 0);
          break;
        } else if (nudge) {
          nudge = false;
          resetIdleAnimation();
        }
        if (idleAnimationFrame < 8) {
          setSprite("tired", 0);
          break;
        }
        setSprite("sleeping", Math.floor(idleAnimationFrame / 4));
        if (idleAnimationFrame > 192 && !isSleepMode()) {
          resetIdleAnimation();
        }
        break;
      case "scratchWallN":
      case "scratchWallS":
      case "scratchWallE":
      case "scratchWallW":
      case "scratchSelf":
        setSprite(idleAnimation, idleAnimationFrame);
        if (idleAnimationFrame > 9) {
          resetIdleAnimation();
        }
        break;
      case "tired":
        setSprite("tired", 0);
        if (idleAnimationFrame > 12) {
          resetIdleAnimation();
        }
        break;
      case "alert":
        setSprite("alert", 0);
        if (idleAnimationFrame > 6) {
          resetIdleAnimation();
        }
        break;
      default:
        setSprite("idle", 0);
        return;
    }
    idleAnimationFrame += 1;
  }

  function frame() {
    frameCount += 1;

    if (isTaskbarRoamMode()) {
      if (!roamInfo && !roamPending) {
        refreshTaskbarRoam();
      }
      if (roamTarget) {
        mousePosX = roamTarget.x;
        mousePosY = roamTarget.y;
      } else {
        mousePosX = nekoPosX;
        mousePosY = nekoPosY;
      }
    }

    if (grabbing) {
      if (grabStop) {
        setSprite("alert", 0);
      }
      return;
    }

    const diffX = nekoPosX - mousePosX;
    const diffY = nekoPosY - mousePosY;
    const distance = Math.sqrt(diffX ** 2 + diffY ** 2);

    if (isSleepMode() && Math.abs(diffY) < nekoSpeed && Math.abs(diffX) < nekoSpeed) {
      nekoPosX = mousePosX;
      nekoPosY = mousePosY;
      clampToDesktop();
      updateWindowPosition();
      idle();
      return;
    }

    const idleDistance = isTaskbarRoamMode() && roamTarget ? 12 : 48;
    if ((distance < nekoSpeed || distance < idleDistance) && !isSleepMode()) {
      if (isTaskbarRoamMode() && roamTarget) {
        if (distance < 24) {
          if (roamDwell <= 0) {
            roamDwell = 20 + Math.floor(Math.random() * 60);
          } else {
            roamDwell -= 1;
            if (roamDwell === 0) {
              pickRoamTarget();
            }
          }
        }
      }
      idle();
      return;
    }

    idleAnimation = null;
    idleAnimationFrame = 0;

    if (idleTime > 1) {
      setSprite("alert", 0);
      idleTime = Math.min(idleTime, 7);
      idleTime -= 1;
      return;
    }

    if (distance === 0) {
      idle();
      return;
    }

    let direction = diffY / distance > 0.5 ? "N" : "";
    direction += diffY / distance < -0.5 ? "S" : "";
    direction += diffX / distance > 0.5 ? "W" : "";
    direction += diffX / distance < -0.5 ? "E" : "";
    setSprite(direction, frameCount);

    nekoPosX -= (diffX / distance) * nekoSpeed;
    nekoPosY -= (diffY / distance) * nekoSpeed;

    clampToDesktop();
    updateWindowPosition();
  }

  nekoEl.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;

    grabbing = true;
    const startX = event.screenX;
    const startY = event.screenY;
    const startNekoX = nekoPosX;
    const startNekoY = nekoPosY;

    const mousemove = (moveEvent) => {
      const deltaX = moveEvent.screenX - startX;
      const deltaY = moveEvent.screenY - startY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaX > absDeltaY && absDeltaX > 10) {
        setSprite(deltaX > 0 ? "scratchWallW" : "scratchWallE", frameCount);
      } else if (absDeltaY > absDeltaX && absDeltaY > 10) {
        setSprite(deltaY > 0 ? "scratchWallN" : "scratchWallS", frameCount);
      }

      if (grabStop || absDeltaX > 10 || absDeltaY > 10 || Math.sqrt(deltaX ** 2 + deltaY ** 2) > 10) {
      grabStop = false;
      if (grabTimeout) {
        clearTimeout(grabTimeout);
      }
        grabTimeout = setTimeout(() => {
          grabStop = true;
          nudge = false;
        }, 150);
      }

      nekoPosX = startNekoX + deltaX;
      nekoPosY = startNekoY + deltaY;
      clampToDesktop();
      updateWindowPosition();
    };

    const mouseup = () => {
      grabbing = false;
      nudge = true;
      resetIdleAnimation();
      if (isTaskbarRoamMode()) {
        refreshTaskbarRoam();
      }
      window.removeEventListener("mousemove", mousemove);
      window.removeEventListener("mouseup", mouseup);
    };

    window.addEventListener("mousemove", mousemove);
    window.addEventListener("mouseup", mouseup);
  });

  nekoEl.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    applyKuroNeko(!kuroNeko);
    window.oneko.updateSettings({ kuroNeko });
  });

  nekoEl.addEventListener("dblclick", async () => {
    const nextMode = isSleepMode() ? lastNonSleepMode : "sleep";
    applyMode(nextMode);
    window.oneko.updateSettings({ mode: nextMode });
  });

  window.oneko.onCursor((point) => {
    if (mode !== "follow") return;
    mousePosX = point.x;
    mousePosY = point.y;
  });

  window.oneko.onVariantChange((nextVariant) => {
    applyVariant(nextVariant);
  });

  window.oneko.onSettings((nextSettings) => {
    if (!nextSettings) return;
    if (nextSettings.variant) {
      applyVariant(nextSettings.variant);
    }
    if (typeof nextSettings.kuroNeko === "boolean") {
      applyKuroNeko(nextSettings.kuroNeko);
    }
    if (typeof nextSettings.mode === "string") {
      applyMode(nextSettings.mode);
    }
  });

  window.oneko.onModeChange((mode) => {
    applyMode(mode);
  });

  window.oneko.onDisplayChange((info) => {
    applyDisplayInfo(info);
    if (isTaskbarRoamMode()) {
      refreshTaskbarRoam();
    }
  });

  (async () => {
    const info = await window.oneko.getDisplayInfo();
    applyDisplayInfo(info);
    const startBounds = getPrimaryBounds();
    nekoPosX = startBounds.x + 32;
    nekoPosY = startBounds.y + 32;
    mousePosX = nekoPosX;
    mousePosY = nekoPosY;
    applyVariant(variant);
    applyKuroNeko(kuroNeko);
    updateWindowPosition();
    setInterval(frame, 100);
  })();
})();
