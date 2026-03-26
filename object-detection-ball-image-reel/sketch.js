const CANVAS_W = 640;
const CANVAS_H = 480;
const DEFAULT_SLIDE_INTERVAL_MS = 100;
const TARGET_BOX_SIZE = 180;

let detector;
let modelReady = false;

let images = [];
let outputDetections = [];

let slideshowItems = [];
let slideIndex = 0;
let nextSlideAt = 0;
let slideIntervalMs = DEFAULT_SLIDE_INTERVAL_MS;

let detectButton;
let statusEl;
let imageStatusEl;
let detectionStatusEl;
let thumbsEl;
let outputEl;
let speedSlider;
let speedValue;
let speedSliderMin = 10;
let speedSliderMax = 1000;
let gridToggle;
let showGrid = false;
let gridType = 2;
let gridType0El;
let gridType1El;
let gridType2El;

function setup() {
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  canvas.parent("canvas-wrap");
  textFont("Arial");

  detectButton = document.getElementById("detect-btn");
  statusEl = document.getElementById("status");
  imageStatusEl = document.getElementById("image-status") || document.getElementById("imageStatus");
  detectionStatusEl = document.getElementById("detection-status");
  thumbsEl = document.getElementById("thumbs");
  outputEl = document.getElementById("output");
  speedSlider = document.getElementById("speed-slider");
  speedValue = document.getElementById("speed-value");
  gridToggle = document.getElementById("grid-toggle");
  gridType0El = document.getElementById("grid-type-0");
  gridType1El = document.getElementById("grid-type-1");
  gridType2El = document.getElementById("grid-type-2");
  speedSliderMin = Number(speedSlider.min) || speedSliderMin;
  speedSliderMax = Number(speedSlider.max) || speedSliderMax;

  slideIntervalMs = Number(speedSlider.value) || DEFAULT_SLIDE_INTERVAL_MS;
  speedSlider.value = String(slideIntervalMs);
  speedValue.textContent = String(slideIntervalMs);

  speedSlider.addEventListener("input", (event) => {
    slideIntervalMs = Number(event.target.value);
    speedValue.textContent = String(slideIntervalMs);
    nextSlideAt = millis() + slideIntervalMs;
  });

  if (gridToggle) {
    showGrid = gridToggle.checked;
    gridToggle.addEventListener("change", (event) => {
      showGrid = event.target.checked;
    });
  }

  setupGridTypeInputs();

  setupFileInputs();

  detectButton.addEventListener("click", runBallDetection);
  detector = ml5.objectDetection("cocossd", () => {
    modelReady = true;
    refreshDetectButtonState();
    setStatus("Model is ready!");
  });

  setStatus("Loading model...");
  setImageStatus("Load example images or your own");
  setDetectionStatus("0 images detected.");
}

function draw() {
  background(20);

  if (slideshowItems.length === 0) {
    fill(230);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(16);
    text("Slideshow", width / 2, height / 2 - 10);
    return;
  }

  if (millis() >= nextSlideAt) {
    slideIndex = (slideIndex + 1) % slideshowItems.length;
    nextSlideAt = millis() + slideIntervalMs;
  }

  const item = slideshowItems[slideIndex];
  const focusBall = getPrimaryBall(item.ballDetections);

  const ballSize = max(focusBall.width, focusBall.height);
  const scale = TARGET_BOX_SIZE / ballSize;

  const drawW = item.image.width * scale;
  const drawH = item.image.height * scale;

  const ballCenterX = (focusBall.x + focusBall.width / 2) * scale;
  const ballCenterY = (focusBall.y + focusBall.height / 2) * scale;

  const dx = width / 2 - ballCenterX;
  const dy = height / 2 - ballCenterY;
  const gridCenterX = dx + ballCenterX;
  const gridCenterY = dy + ballCenterY;

  push();
  translate(dx, dy);
  image(item.image, 0, 0, drawW, drawH);
  pop();

  if (showGrid) {
    const clampedSpeed = constrain(slideIntervalMs, speedSliderMin, speedSliderMax);
    const rotationStep =
      speedSliderMax === speedSliderMin
        ? 0.01
        : map(clampedSpeed, speedSliderMin, speedSliderMax, 0.08, 0.0015);

    if (gridType === 0) {
      const boxX = dx + focusBall.x * scale;
      const boxY = dy + focusBall.y * scale;

      push();
      stroke("lime");
      strokeWeight(1);
      rectMode(CORNER);
      noFill();
      rect(boxX, boxY, focusBall.width * scale, focusBall.height * scale);
      pop();
    } else if (gridType === 1) {
      push();
      stroke("lime");
      strokeWeight(1);
      rectMode(CENTER);
      noFill();
      translate(width / 2, height / 2);
      rect(0, 0, width * 2, TARGET_BOX_SIZE);
      rect(0, 0, TARGET_BOX_SIZE, height * 2);
      pop();
    } else {
      push();
      stroke("lime");
      strokeWeight(1);
      rectMode(CENTER);
      noFill();
      translate(gridCenterX, gridCenterY);
      rotate(frameCount * rotationStep);
      rect(0, 0, width * 2, TARGET_BOX_SIZE);
      rect(0, 0, TARGET_BOX_SIZE, height * 2);
      pop();
    }
  }

  noStroke();
  fill(255);
  rect(0, 0, width, 28);
  fill(20);
  textAlign(LEFT, CENTER);
  textSize(12);
  text(
    `${item.fileName} • image ${slideIndex + 1}/${slideshowItems.length}`,
    10,
    14
  );
}

function setupFileInputs() {
  
  const fileInput = document.getElementById("file-input");
  const dropzone = document.getElementById("dropzone");

  fileInput.addEventListener("change", (event) => {
    // RESET ALL
    images = [];
    slideshowItems = [];
    outputDetections = [];
    slideIndex = 0;
    renderThumbnails();
    setImageStatus("0 image(s) loaded.");
    if (outputEl) outputEl.textContent = "[]";
    const examplePhotosEl = document.getElementById("example-photos");
    if (examplePhotosEl) examplePhotosEl.innerHTML = "";
      
    handleFiles(event.target.files);
    event.target.value = "";
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.remove("drag-over");
    });
  });

  dropzone.addEventListener("drop", (event) => {
    handleFiles(event.dataTransfer.files);
  });

  // Wire up both example buttons
  setupExampleButton("load-all-examples-btn", "football");
  setupExampleButton("load-basketball-examples-btn", "basketball");
}

function setupExampleButton(btnId, exampleType) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  btn.addEventListener("click", () => {
    loadExamplePNGs(exampleType);
  });
}

function loadExamplePNGs(exampleType = "football") {
  // RESET ALL
  images = [];
  slideshowItems = [];
  outputDetections = [];
  slideIndex = 0;
  renderThumbnails();
  setImageStatus("0 image(s) loaded.");
  if (outputEl) outputEl.textContent = "[]";

  const examplePhotosEl = document.getElementById("example-photos");
  if (examplePhotosEl) examplePhotosEl.innerHTML = "";

  let pngFiles = [];

  if (exampleType === "football") {
    pngFiles = [
      "ball1.png",
      "ball2.png",
      "ball3.png",
      "ball4.png",
      "ball5.png",
      "ball6.png",
      "ball7.png",
      "ball8.png",
      "ball9.png",
      "ball10.png",
      "ball11.png",
      "ball12.png",
      "ball13.png",
      "ball14.png",
      "ball15.png",
    ];
  } else {
    pngFiles = [
      "basketball1.png",
      "basketball2.png",
      "basketball3.png",
      "basketball4.png",
      "basketball5.png",
      "basketball6.png",
      "basketball7.png",
    ];
  }

  // Show thumbnails in the example-photos area
  if (examplePhotosEl) {
    pngFiles.forEach((file) => {
      const imgUrl = `example/${file}`;
      const img = document.createElement("img");
      img.src = imgUrl;
      img.alt = file;
      img.className = "example-thumb";
      img.style.width = "40px";
      img.style.height = "40px";
      img.style.margin = "4px";
      examplePhotosEl.appendChild(img);
    });
  }

  // Load all images into the slideshow pipeline
  pngFiles.forEach((file) => {
    const imgUrl = `example/${file}`;
    loadImage(imgUrl, (p5img) => {
      images.push({
        id: `${Date.now()}-${Math.random()}`,
        fileName: file,
        imgUrl,
        image: p5img,
        ballDetections: [],
        hasBall: null,
        processed: false,
      });
      refreshDetectButtonState();
      renderThumbnails();
      setImageStatus(`${images.length} image(s) loaded.`);
    });
  });
}

function setupGridTypeInputs() {
  const typeInputs = [gridType0El, gridType1El, gridType2El];
  if (typeInputs.some((input) => !input)) {
    return;
  }

  const setActiveType = (nextType) => {
    gridType = nextType;
    gridType0El.checked = nextType === 0;
    gridType1El.checked = nextType === 1;
    gridType2El.checked = nextType === 2;
  };

  const initialType = gridType0El.checked ? 0 : gridType1El.checked ? 1 : 2;
  setActiveType(initialType);

  gridType0El.addEventListener("change", (event) => {
    if (event.target.checked) { setActiveType(0); return; }
    setActiveType(gridType);
  });

  gridType1El.addEventListener("change", (event) => {
    if (event.target.checked) { setActiveType(1); return; }
    setActiveType(gridType);
  });

  gridType2El.addEventListener("change", (event) => {
    if (event.target.checked) { setActiveType(2); return; }
    setActiveType(gridType);
  });
}

function handleFiles(fileList) {
  const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
  if (files.length === 0) return;

  files.forEach((file) => {
    const imgUrl = URL.createObjectURL(file);
    loadImage(
      imgUrl,
      (img) => {
        images.push({
          id: `${Date.now()}-${Math.random()}`,
          fileName: file.name,
          imgUrl,
          image: img,
          ballDetections: [],
          hasBall: null,
          processed: false,
        });
        refreshDetectButtonState();
        renderThumbnails();
        setImageStatus(`${images.length} image(s) loaded.`);
      },
      () => {
        URL.revokeObjectURL(imgUrl);
      }
    );
  });
}

async function runBallDetection() {
  if (!modelReady || images.length === 0) return;

  detectButton.disabled = true;
  outputDetections = [];
  slideshowItems = [];
  setDetectionStatus("Detecting... 0 images detected.");
  setStatus("Detecting sports balls across all images...");

  for (let i = 0; i < images.length; i += 1) {
    const item = images[i];
    const detections = await detectOnce(item.image);
    const ballDetections = detections.filter((detection) => {
      const normalized = String(detection.label || "").toLowerCase().replace(/\s+/g, "");
      return normalized === "sportsball";
    });

    item.ballDetections = ballDetections;
    item.hasBall = ballDetections.length > 0;
    item.processed = true;

    if (item.hasBall) {
      ballDetections.forEach((ball) => {
        outputDetections.push({
          imgUrl: item.imgUrl,
          x: ball.x,
          y: ball.y,
          width: ball.width,
          height: ball.height,
        });
      });
      slideshowItems.push(item);
    } else {
      item.detectedLabels = detections.map((d) => d.label).filter(Boolean);
    }

    setDetectionStatus(`Detecting... ${slideshowItems.length} images detected.`);
    setStatus(`Detecting... ${i + 1}/${images.length}`);
    renderThumbnails();
  }

  slideIndex = 0;
  nextSlideAt = millis() + slideIntervalMs;

  outputEl.textContent = JSON.stringify(outputDetections, null, 2);
  renderThumbnails();
  refreshDetectButtonState();

  const withoutBall = images.length - slideshowItems.length;
  setDetectionStatus(`${slideshowItems.length} images detected.`);
  setStatus(
    `Done. ${slideshowItems.length} image(s) with sports ball, ${withoutBall} without sports ball.`
  );
}

function detectOnce(img) {
  return new Promise((resolve) => {
    detector.detect(img, (...args) => {
      if (args.length === 1 && Array.isArray(args[0])) { resolve(args[0]); return; }
      if (args.length >= 2 && Array.isArray(args[1])) { resolve(args[1]); return; }
      if (args.length >= 1 && Array.isArray(args[0])) { resolve(args[0]); return; }
      resolve([]);
    });
  });
}

function getPrimaryBall(ballDetections) {
  return ballDetections.reduce((largest, current) => {
    const currentArea = current.width * current.height;
    const largestArea = largest.width * largest.height;
    return currentArea > largestArea ? current : largest;
  }, ballDetections[0]);
}

function renderThumbnails() {
  thumbsEl.innerHTML = "";

  images.forEach((item) => {
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (item.processed && !item.hasBall) {
      thumb.classList.add("no-ball");
    }

    const imageEl = document.createElement("img");
    imageEl.src = item.imgUrl;
    imageEl.alt = item.fileName;

    const meta = document.createElement("div");
    meta.className = "meta";

    const fileName = document.createElement("div");
    fileName.className = "file-name";
    fileName.textContent = item.fileName;

    const status = document.createElement("div");
    status.className = "status";
    if (!item.processed) {
      status.textContent = "waiting";
    } else if (item.hasBall) {
      status.textContent = `${item.ballDetections.length} sports ball`;
    } else {
      if (item.detectedLabels && item.detectedLabels.length > 0) {
        status.textContent = `labels: ${item.detectedLabels.join(", ")}`;
      } else {
        status.textContent = "no sports ball";
      }
    }

    meta.appendChild(fileName);
    meta.appendChild(status);

    thumb.appendChild(imageEl);
    thumb.appendChild(meta);
    thumbsEl.appendChild(thumb);
  });
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setImageStatus(message) {
  if (!imageStatusEl) return;
  imageStatusEl.textContent = message;
}

function setDetectionStatus(message) {
  if (!detectionStatusEl) return;
  detectionStatusEl.textContent = message;
}

function refreshDetectButtonState() {
  detectButton.disabled = !modelReady || images.length === 0;
}