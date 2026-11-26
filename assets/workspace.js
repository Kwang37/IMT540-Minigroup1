const isP3 = document.body.dataset.flow === "p3";
    const STORAGE_KEY = isP3 ? "FOUR_SQUARES_P3_SESSION_STATE" : "FOUR_SQUARES_SESSION_STATE_V3";
    const usesExploration = () => isP3 && mode === "online";
    const participantOptions = ["modeHeading", "modePicker", "changeConcept", "reviewTutorial"];
    const EXPLORATION_COUNT = 6;
    const DEFAULT_SQUARE_SIZE = 16.5;
    const MIN_SQUARE_SIZE = 8.5;
    const MAX_SQUARE_SIZE = 36.5;
    const SQUARE_SIZE_STEP = 4;

    let explorations = [];
    let reviewedArrangement = null;

    let mode = "inperson";
    let currentStep = 1;
    let v1Locked = false;
    let isWorkingDraftDirty = false;
    let choices = [];
    let activeChoiceIdx = 0;
    let keptChoiceIdx = 0;
    let workingSquares = [];
    const HISTORY_LIMIT = 20;
    let sliderEdit = null;
    const undoStack = [];
    const redoStack = [];
    let activeSquareId = null;
    let squareGesture = null;
    const resizeCornerAngles = { nw: -135, ne: -45, se: 45, sw: 135 };

    let firstReflection = null;
    let secondReflection = null;
    let workingPhoto = "";
    let photoRequest = 0;
    let galleryPostId = null;
    const inspiration = new Set();
    const gallery = new Map();
    const galleryKey = "4SQUARES_GALLERY_V1";
    const commentTypes = ["I Notice", "I Wonder", "What If"];
    const concepts = ["Tension", "Balance", "Chaos", "Order"];
    const photoPattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

    function galleryPosts() {
      return [...gallery.values()].filter(post => post.concept === selectedConcept);
    }

    const pdfPattern = /^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/;
    const maxPdfBytes = 1_000_000;

    function photoPreview(src) {
      if (pdfPattern.test(src)) {
        const preview = document.createElement("div");
        const frame = document.createElement("iframe");
        frame.title = "Four-square composition PDF";
        frame.style.cssText = "display:block;width:100%;height:clamp(14rem,55vh,32rem);border:0";
        frame.src = src;
        preview.append(frame);
        return preview;
      }
      const image = document.createElement("img");
      image.className = "composition-photo";
      image.alt = "Photograph of a four-square composition";
      image.src = src;
      return image;
    }

    function useDigitalCanvas() {
      if (mode !== "inperson" || currentStep !== 3) return;
      photoRequest++;
      workingPhoto = "";
      document.getElementById("photoStatus").textContent = "";
      syncPhotoWorkspace();
      updateDraftStatusUI();
      renderBoard();
      squareButtonMap.values().next().value?.focus();
    }

    function syncPhotoWorkspace() {
      const usePhoto = mode === "inperson";
      const back = document.getElementById("backToComposition");
      back.hidden = v1Locked;
      back.textContent = usesExploration() ? "Back to Arrangements" : "Back to Composition";
      document.getElementById("nextExploration").hidden = usePhoto || (!isP3 && currentStep === 1.25);
      document.getElementById("reflectionIntro").hidden = usePhoto;
      document.getElementById("firstReflectionPrompt").textContent = isP3 ? `How does this arrangement capture ${selectedConcept.toLowerCase()} for you?` : usePhoto
        ? "Why did you arrange the squares this way?"
        : "What idea or feeling did you want to show? Describe one choice you made with the squares and why.";
      document.getElementById("ghostToolbar").hidden = usePhoto || currentStep !== 3;
      if (isP3) return;

      document.getElementById("createInstruction").textContent =
        `Add your four-square arrangement for ${selectedConcept}.`;
      document.getElementById("photoWorkspace").hidden = !usePhoto;
      document.getElementById("variationInstruction").textContent = usePhoto
        ? "Try a new arrangement on the canvas or add a photo or PDF. Save it as a new version."
        : "Move or turn a square to try an idea from your reflection. Choose Save New Version to keep both arrangements.";
      document.getElementById("board").hidden = usePhoto && (currentStep !== 3 || Boolean(workingPhoto));
      document.getElementById("useCanvasBtn").hidden = currentStep !== 3 || !workingPhoto;
      document.getElementById("galleryGhostToggle").closest("label").hidden = usePhoto;
      const canAddPhoto = usePhoto && ((currentStep === 1 && !v1Locked) || currentStep === 3);
      document.getElementById("photoControls").hidden = !canAddPhoto;
      for (const id of ["compositionCamera", "compositionUpload", "takePhotoBtn", "choosePhotoBtn"]) {
        document.getElementById(id).disabled = !canAddPhoto;
      }
      const preview = document.getElementById("compositionPhoto");
      preview.hidden = !workingPhoto;
      if (preview.dataset.source !== workingPhoto) {
        preview.replaceChildren();
        if (workingPhoto) {
          preview.append(photoPreview(workingPhoto));
          if (pdfPattern.test(workingPhoto)) {
            const link = document.createElement("a");
            link.href = workingPhoto;
            link.download = "composition.pdf";
            link.textContent = "Download PDF";
            preview.append(link);
          }
        }
        preview.dataset.source = workingPhoto;
      }
    }

    async function loadCompositionPhoto(input) {
      const file = input.files[0];
      if (!file) return;
      const request = ++photoRequest;
      const status = document.getElementById("photoStatus");
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      status.textContent = isPdf ? "Reading PDF…" : "Reading photo…";
      try {
        let source;
        if (isPdf) {
          if (file.size > maxPdfBytes) {
            status.textContent = "Choose a PDF under 1 MB, or use a photo.";
            return;
          }
          if (!(await file.slice(0, 5).text()).startsWith("%PDF-")) throw new Error("Invalid PDF");
          source = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve("data:application/pdf;base64," + reader.result.split(",")[1]);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
        } else {
          const bitmap = await createImageBitmap(file);
          const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          source = canvas.toDataURL("image/jpeg", 0.78);
        }
        if (request !== photoRequest || input.disabled || mode !== "inperson" || document.getElementById("workspaceShell").hidden) return;
        workingPhoto = source;
        status.textContent = isPdf ? "PDF added." : "Photo added.";
        syncPhotoWorkspace();
        updateDraftStatusUI();
        validateStep1Gate();
      } catch {
        if (request === photoRequest) status.textContent = isPdf ? "This PDF could not be opened." : "This image could not be opened. Try a JPEG or PNG.";
      } finally {
        if (request === photoRequest) input.value = "";
      }
    }

    function cacheGallery(message) {
      const status = document.getElementById("galleryStatus");
      let stored = true;
      try {
        localStorage.setItem(galleryKey, JSON.stringify([...gallery.values()]));
        status.textContent = message;
      } catch {
        stored = false;
        status.textContent = message + " Export the gallery file to keep a copy.";
      }
      renderGallery();
      return stored;
    }

    function publishToGallery() {
      if (!firstReflection || galleryPostId) return;
      const baseline = choices[0];
      const interpretation = document.getElementById("galleryInterpretation").value.trim();
      if (!interpretation) {
        document.getElementById("galleryInterpretation").focus();
        return;
      }
      galleryPostId = crypto.randomUUID();
      gallery.set(galleryPostId, {
        id: galleryPostId, concept: selectedConcept, interpretation,
        photo: baseline.photo, squares: baseline.photo ? [] : clone(baseline.squares), comments: []
      });
      if (cacheGallery("Anonymous composition added.")) persistSessionState();
    }

    function readGalleryPosts(posts) {
      if (!Array.isArray(posts) || posts.length > 100) throw new Error("Invalid gallery.");
      return posts.map(post => {
        if (!post || !/^[a-f0-9-]{36}$/.test(post.id) || !concepts.includes(post.concept)
            || !Array.isArray(post.comments) || post.comments.length > 200) throw new Error("Invalid gallery.");
        const photo = typeof post.photo === "string" && post.photo.length < 2_000_000 && (photoPattern.test(post.photo) || pdfPattern.test(post.photo)) ? post.photo : "";
        if (!photo && (!Array.isArray(post.squares) || post.squares.length !== 4 ||
            post.squares.some(sq => !sq || ![sq.x, sq.y, sq.rot].every(Number.isFinite)
              || sq.x < -MAX_SQUARE_SIZE || sq.x > 100 || sq.y < -MAX_SQUARE_SIZE || sq.y > 100
              || !Number.isFinite(squareSize(sq)) || squareSize(sq) < MIN_SQUARE_SIZE || squareSize(sq) > MAX_SQUARE_SIZE))) throw new Error("Invalid composition.");
        const squares = photo ? [] : post.squares.map(sq => ({x: sq.x, y: sq.y, rot: sq.rot, size: squareSize(sq)}));
        const comments = post.comments.filter(comment => comment && /^[a-f0-9-]{36}$/.test(comment.id)
          && commentTypes.includes(comment.type) && typeof comment.text === "string" && comment.text.length <= 1000)
          .map(({id, type, text}) => ({id, type, text}));
        return { id: post.id, concept: post.concept, photo, squares, comments,
          interpretation: typeof post.interpretation === "string" ? post.interpretation.slice(0, 1000) : "" };
      });
    }

    function mergeGallery(posts) {
      for (const post of posts) {
        const existing = gallery.get(post.id);
        if (!existing) gallery.set(post.id, post);
        else {
          const ids = new Set(existing.comments.map(comment => comment.id));
          for (const comment of post.comments) {
            if (!ids.has(comment.id)) {
              existing.comments.push(comment);
              ids.add(comment.id);
            }
          }
        }
      }
    }

    if (!isP3) {
      try {
        mergeGallery(readGalleryPosts(JSON.parse(localStorage.getItem(galleryKey) || "[]")));
      } catch {}
    }

    async function importGallery(input) {
      const file = input.files[0];
      if (!file) return;
      try {
        if (file.size > 20_000_000) throw new Error("Gallery file is too large.");
        const data = JSON.parse(await file.text());
        if (data.format !== "4squares-gallery-v1") throw new Error("Invalid gallery format.");
        mergeGallery(readGalleryPosts(data.posts));
        cacheGallery("Gallery imported. Works appear under their original concept.");
      } catch {
        document.getElementById("galleryStatus").textContent = "This file could not be imported as a 4SQUARES gallery.";
      } finally {
        input.value = "";
      }
    }

    function exportGallery() {
      const blob = new Blob([JSON.stringify({ format: "4squares-gallery-v1", posts: [...gallery.values()] })], { type: "application/json" });
      triggerFileDownload(blob, "4squares-gallery.json");
    }

    const galleryExamples = {
      Tension: [
        ["Held Apart", [[5,23,0,28],[36,32,0,13],[18,57,0,19],[68,43,19,16]]],
        ["Near Collision", [[11,24,-12,24],[34,40,18,18],[55,46,-16,27],[76,69,13,11]]],
        ["On Edge", [[15,68,0,16],[36,68,0,16],[57,68,0,16],[49,-8,25,31]]],
        ["Squeezed", [[-8,34,0,34],[29,43,0,15],[48,44,0,13],[65,34,0,34]]],
        ["Standoff", [[15, 25, 0], [15, 57, 0], [69, 25, 0], [69, 57, 0]]],
        ["Pulled Away", [[16, 43, 0], [35, 43, 0], [54, 43, 0], [72, 21, 28]]]
      ],
      Balance: [
        ["Counterweight", [[16,21,0,14],[16,43,0,14],[16,65,0,14],[59,36,34,28]]],
        ["Two Pairs", [[14,20,0,23],[42,26,0,11],[47,66,0,11],[64,60,0,23]]],
        ["Balanced Around a Gap", [[42,13,0,16],[68,36,0,24],[42,71,0,16],[8,36,0,24]]],
        ["Mirror Pairs", [[18, 25, -20], [18, 60, 20], [66, 25, 20], [66, 60, -20]]],
        ["Quiet Center", [[25,31,0,22],[53,36,0,12],[35,55,0,12],[51,50,0,22]]],
        ["Corner Weights", [[13, 13, 0], [69, 13, 0], [13, 69, 0], [69, 69, 0]]]
      ],
      Chaos: [
        ["Scatter", [[-10,9,-24,33],[61,13,31,13],[36,44,42,26],[66,70,-12,20]]],
        ["Collision", [[17,22,19,31],[36,32,-38,28],[50,44,13,18],[29,54,52,22]]],
        ["Broken Sequence", [[10,61,17,14],[23,14,36,24],[48,49,-27,12],[66,13,4,30]]],
        ["Interrupted Grid", [[23, 23, 0], [59, 22, 24], [19, 66, -19], [48, 49, 43]]],
        ["Uneven Drift", [[-7,18,-11,24],[21,41,36,14],[56,37,-34,29],[67,76,14,10]]],
        ["Crossing Paths", [[27, 21, 35], [54, 34, -30], [31, 53, -19], [62, 65, 39]]]
      ],
      Order: [
        ["Grid", [[25,25,0],[58,25,0],[25,58,0],[58,58,0]]],
        ["Even Interval", [[8,36,0,24],[35,42,0,12],[50,36,0,24],[77,42,0,12]]],
        ["Measured Steps", [[12,12,0,10],[28,28,0,15],[44,44,0,20],[60,60,0,25]]],
        ["Neat Column", [[36,-8,0,28],[41,28,0,18],[36,54,0,28],[41,90,0,18]]],
        ["Repeating Tilt", [[13, 25, 25], [39, 25, 25], [13, 59, 25], [39, 59, 25]]],
        ["Right Angle", [[17,16,0,12],[17,35,0,12],[17,54,0,26],[50,54,0,12]]]
      ]
    };

    const sampleReadings = {
      Tension: [
        "A large square anchors the cluster on the left. The smaller, tilted square across the gap looks held back by the space between them.",
        "The squares crowd the center at competing angles. The small square at the end gives the collision a direction.",
        "Three evenly spaced squares stabilize the bottom. The large square above is tilted and cropped to make its position feel precarious.",
        "Two large squares press inward on two smaller ones. Cropping the left square makes the pressure feel as if it continues beyond the frame.",
        "I placed two pairs across a wide gap. The empty middle feels like a space neither side will cross.",
        "The tilted square breaks away from the row. I wanted the others to seem as if they were holding it back."
      ],
      Balance: [
        "The three small squares accumulate weight on one side. A single larger square farther to the right balances their combined pull.",
        "Repeating a large–small pair on opposite diagonals balances the visual weight without making both sides identical.",
        "Two larger squares balance each other across the middle. The smaller top and bottom squares leave room for the center to stay open.",
        "I mirrored the angles on both sides so the rotation feels balanced.",
        "The larger squares sit at opposite corners of a compact group. The two smaller squares keep the weight from collecting on a single side.",
        "I gave each corner the same visual weight and left the middle open."
      ],
      Chaos: [
        "Different sizes, angles, and gaps pull the eye in several directions. The cropped square suggests the scatter continues beyond the frame.",
        "The large squares overlap at competing angles. The smaller one crowds in from the right, making the center feel unstable.",
        "The eye can follow a loose left-to-right path, but the abrupt jumps in size, height, and angle interrupt its rhythm.",
        "I used a familiar grid and then disrupted its positions and angles.",
        "The cropped square starts the movement at the left edge. The size changes and uneven spacing make the sequence drift instead of settling into a pattern.",
        "The alternating positions and opposing angles make the eye zigzag through the frame."
      ],
      Order: [
        "I used a repeated row and column spacing so each square has a predictable place.",
        "The squares alternate large and small along the same centerline. The repeated pair and equal gaps make the sequence predictable.",
        "Each square starts at an equal diagonal step and grows by the same amount. The two progressions make the arrangement feel systematic.",
        "The sizes alternate along a single centerline. The first and last squares continue past the frame, suggesting the pattern carries on.",
        "The squares are tilted, but repeating the same angle and spacing makes them feel ordered.",
        "The small squares establish a regular spacing. The larger square marks the corner where the direction changes."
      ]
    };

    function createFlipCard(title, source, reading, layout, photo) {
      const figure = document.createElement("figure");
      figure.className = "clothesline-card glass-card";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "flip-art";
      const front = document.createElement("span");
      front.className = "canvas-frame sample-art";
      front.setAttribute("role", "img");
      front.setAttribute("aria-label", photo ? "Physical composition photo" : layout.map(([x,y,rot,size = DEFAULT_SQUARE_SIZE], i) =>
        `Square ${i + 1} at ${Math.round(x)}% across and ${Math.round(y)}% down, rotated ${rot} degrees, side ${size}% of the board`).join(". "));
      if (pdfPattern.test(photo || "")) front.textContent = "PDF composition";
      else if (photo) front.append(photoPreview(photo));
      else for (const [x, y, rot, size] of layout) {
        const tile = document.createElement("span");
        tile.className = "sample-square";
        placeSquare(tile, {x, y, rot, size});
        front.append(tile);
      }
      const back = document.createElement("span");
      back.className = "art-back";
      back.hidden = true;
      const heading = document.createElement("strong");
      heading.textContent = "Creator’s Interpretation";
      const explanation = document.createElement("span");
      explanation.textContent = reading;
      back.append(heading, explanation);
      const hint = document.createElement("span");
      hint.className = "flip-hint";
      hint.setAttribute("aria-hidden", "true");
      button.append(front, back, hint);
      const updateSide = flipped => {
        front.hidden = flipped;
        back.hidden = !flipped;
        hint.textContent = flipped ? "Back to composition" : "Flip to read interpretation";
        button.setAttribute("aria-expanded", String(flipped));
        button.setAttribute("aria-label", flipped ? `Show composition: ${title}` : `Read interpretation: ${title}`);
        button.setAttribute("aria-description", flipped ? reading : front.getAttribute("aria-label"));
      };
      updateSide(false);
      button.onclick = () => updateSide(back.hidden);
      const caption = document.createElement("figcaption");
      caption.className = "card-caption";
      const name = document.createElement("strong");
      name.textContent = title;
      const label = document.createElement("small");
      label.textContent = source;
      caption.append(name);
      if (isP3) back.append(label);
      else caption.append(label);
      figure.append(button, caption);
      if (pdfPattern.test(photo || "")) {
        const link = document.createElement("a");
        link.href = photo;
        link.download = "composition.pdf";
        link.textContent = "Download composition PDF";
        figure.append(link);
      }
      return figure;
    }

    function scrollSamples(direction) {
      const grid = document.getElementById("gallerySamples");
      const first = grid.children[0];
      const second = grid.children[1];
      if (!first || !second) return;
      grid.scrollBy({
        left: direction * (second.offsetLeft - first.offsetLeft),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    }

    let markedSample = null;
    let savedSamples = [];
    let variationSkipped = false;
    let exportUnlocked = false;
    let decisionRecorded = false;
    let revisingDecision = false;
    let compareRequested = false;

    function gallerySampleCard(index) {
      const [title, layout] = galleryExamples[selectedConcept][index];
      return createFlipCard(title, "Sample / AI-generated", sampleReadings[selectedConcept][index], layout);
    }

    function compositionReference(label, squares) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = label;
      const board = document.createElement("div");
      board.className = "canvas-frame";
      board.setAttribute("role", "img");
      board.setAttribute("aria-label", label + " composition");
      squares.forEach(square => {
        const shape = document.createElement("div");
        shape.className = "square-node";
        placeSquare(shape, square);
        board.append(shape);
      });
      section.append(heading, board);
      return section;
    }

    function renderReflectionReference() {
      if (isP3) {
        const cards = savedSamples.map(gallerySampleCard);
        document.getElementById("reflectionReferenceCard").replaceChildren(
          compositionReference("Your V1", choices[0].squares), ...cards
        );
        document.getElementById("secondReflectionPrompt").textContent = cards.length
          ? "What do you notice about your own arrangement beside the examples you saved?"
          : "What did the Gallery help you notice about your own arrangement?";
        return;
      }
      const details = document.getElementById("reflectionReference");
      const container = document.getElementById("reflectionReferenceCard");
      const hasSavedCard = mode === "online" && Boolean(galleryExamples[selectedConcept]?.[markedSample]);
      details.hidden = !hasSavedCard;
      details.open = hasSavedCard;
      container.replaceChildren();
      if (hasSavedCard) container.append(gallerySampleCard(markedSample));

      document.getElementById("secondReflectionPrompt").textContent = hasSavedCard
        ? "What’s one difference between your arrangement and the saved example?"
        : "What did the Gallery help you notice?";
    }

    function renderGallerySamples() {
      const grid = document.getElementById("gallerySamples");
      grid.replaceChildren();
      document.getElementById("galleryTitle").textContent = isP3 ? `Ways to show ${selectedConcept.toLowerCase()}` : `${selectedConcept} Gallery`;
      if (!isP3) document.getElementById("sampleSaveHelp").hidden = mode !== "online";
      const status = document.getElementById("sampleSaveStatus");
      const examples = galleryExamples[selectedConcept] || [];
      status.textContent = "";
      const marks = [];
      const updateMarks = () => marks.forEach((button, index) => {
        const saved = isP3 ? savedSamples.includes(index) : index === markedSample;
        button.setAttribute("aria-pressed", String(saved));
        button.textContent = saved ? "Saved for Reflection ✓" : "Save for Reflection";
      });
      examples.forEach(([title], index) => {
        const card = gallerySampleCard(index);
        if (mode === "online" && (!isP3 || !secondReflection)) {
          const mark = document.createElement("button");
          mark.type = "button";
          mark.className = "btn btn-sm sample-save";
          marks.push(mark);
          mark.onclick = () => {
            if (isP3) {
              const saved = savedSamples.includes(index);
              if (!saved && savedSamples.length >= 2) {
                status.textContent = "Remove a saved example before adding another.";
                return;
              }
              savedSamples = saved ? savedSamples.filter(item => item !== index) : [...savedSamples, index];
              status.textContent = saved ? `Removed “${title}”.` : `Saved “${title}” for reflection.`;
              updateMarks();
              persistSessionState();
              return;
            }
            const previousTitle = examples[markedSample]?.[0];
            markedSample = markedSample === index ? null : index;
            updateMarks();
            if (markedSample === null) status.textContent = `Removed “${title}” from Reflection 2.`;
            else if (previousTitle) status.textContent = `Saved “${title}” in place of “${previousTitle}”.`;
            else status.textContent = `Saved “${title}” for Reflection 2.`;
            persistSessionState();
          };
          card.append(mark);
        }
        grid.append(card);
      });
      updateMarks();
      grid.scrollLeft = 0;
    }

    function showGalleryV1() {
      const details = document.getElementById("galleryV1");
      const preview = document.getElementById("galleryV1Preview");
      const photo = choices[0]?.photo;
      if (details.hidden || !details.open || !photo || preview.dataset.source === photo) return;
      preview.replaceChildren(photoPreview(photo));
      if (pdfPattern.test(photo)) {
        const link = document.createElement("a");
        link.href = photo;
        link.download = "my-v1.pdf";
        link.textContent = "Download my V1 PDF";
        preview.append(link);
      }
      preview.dataset.source = photo;
    }

    function renderGallery() {
      renderGallerySamples();
      if (isP3) return;

      const myV1 = document.getElementById("galleryV1");
      myV1.hidden = mode !== "inperson" || !choices[0]?.photo;
      if (myV1.hidden) myV1.open = false;
      document.getElementById("galleryV1Sharing").textContent = gallery.has(galleryPostId)
        ? "You added this composition to the Gallery anonymously."
        : "This is your own composition. It only appears in the Gallery if you choose Add V1 to Gallery.";
      showGalleryV1();
      const list = document.getElementById("galleryList");
      list.replaceChildren();
      document.querySelector('[data-click="publish-to-gallery"]').disabled = Boolean(galleryPostId);
      const posts = galleryPosts();
      document.getElementById("peerWorks").hidden = !posts.length;
      posts.forEach((post, index) => {
        const card = document.createElement("article");
        card.className = "disclosure-block";
        card.append(createFlipCard(
          "Anonymous Composition " + (index + 1), "Peer Work",
          post.interpretation || "The creator shared this work without a written interpretation.",
          post.squares.map(sq => [sq.x, sq.y, sq.rot, squareSize(sq)]), post.photo
        ));
        const discussion = document.createElement("details");
        const discussionLabel = document.createElement("summary");
        discussionLabel.textContent = "Comments";
        discussion.append(discussionLabel);
        for (const comment of post.comments) {
          const quote = document.createElement("blockquote");
          quote.textContent = comment.type + " · " + comment.text;
          discussion.append(quote);
        }
        const mark = document.createElement("button");
        mark.type = "button";
        mark.className = "btn";
        mark.textContent = "This Made Me Rethink My Design";
        mark.setAttribute("aria-pressed", inspiration.has(post.id));
        mark.onclick = () => {
          if (inspiration.has(post.id)) inspiration.delete(post.id);
          else inspiration.add(post.id);
          mark.setAttribute("aria-pressed", inspiration.has(post.id));
          persistSessionState();
        };
        const form = document.createElement("form");
        const typeLabel = document.createElement("label");
        const type = document.createElement("select");
        typeLabel.append("Comment starter", type);
        commentTypes.forEach(label => type.add(new Option(label)));
        const textLabel = document.createElement("label");
        const field = document.createElement("textarea");
        field.required = true;
        field.maxLength = 1000;
        textLabel.append("Anonymous comment", field);
        const submit = document.createElement("button");
        submit.className = "btn";
        submit.textContent = "Post Comment";
        form.append(typeLabel, textLabel, submit);
        form.onsubmit = event => {
          event.preventDefault();
          const value = field.value.trim();
          if (!value || post.comments.length >= 200) return;
          post.comments.push({ id: crypto.randomUUID(), type: type.value, text: value });
          cacheGallery("Comment added. Export the gallery file to share it.");
          document.getElementById("galleryStatus").tabIndex = -1;
          document.getElementById("galleryStatus").focus();
        };
        discussion.append(form);
        card.append(mark, discussion);
        list.append(card);
      });
    }

    const squareButtonMap = new Map();

    function clone(data) {
      return JSON.parse(JSON.stringify(data));
    }

    function freezeV1Choice(choiceObj) {
      const copy = clone(choiceObj);
      copy.immutable = true;
      copy.squares.forEach(sq => Object.freeze(sq));
      Object.freeze(copy.squares);
      return copy;
    }

    function squareSize(square) {
      return square.size ?? DEFAULT_SQUARE_SIZE;
    }

    function placeSquare(element, square) {
      element.style.left = square.x + "%";
      element.style.top = square.y + "%";
      element.style.width = squareSize(square) + "%";
      element.style.height = squareSize(square) + "%";
      element.style.transform = `rotate(${square.rot}deg)`;
    }

    function constrainSquarePosition(square, x, y) {
      const size = squareSize(square);
      // Allow cropping while leaving part of the square available to grab.
      const visible = size / 4;
      const clamp = value => Math.max(visible - size, Math.min(100 - visible, value));
      return { x: clamp(x), y: clamp(y) };
    }

    function resizeSquare(square, direction) {
      setSquareSize(square, squareSize(square) + direction * SQUARE_SIZE_STEP);
    }

    function setSquareSize(square, targetSize) {
      const oldSize = squareSize(square);
      const size = Math.max(MIN_SQUARE_SIZE, Math.min(MAX_SQUARE_SIZE, Math.round(targetSize * 10) / 10));
      if (size === oldSize) return;
      const shift = (oldSize - size) / 2;
      square.size = size;
      Object.assign(square, constrainSquarePosition(square, square.x + shift, square.y + shift));
    }

    function squaresEqual(a, b) {
      if (!a || !b || a.length !== b.length) return false;
      return a.every((s, i) => s.x === b[i].x && s.y === b[i].y && s.rot === b[i].rot && squareSize(s) === squareSize(b[i]));
    }

    let selectedConcept = "";

    let tutorialFromWorkspace = false;
    let tutorialStep = 0;
    const tutorialPages = [
      ["Express a concept", "Use exactly four squares to communicate the concept you chose. Start with one spatial choice: change the gaps, align the edges, overlap two squares, or rotate one. Think about how that choice changes the feeling."],
      ["Create your first composition", "Drag a square to move it. With a keyboard, use Tab to focus a square, the arrow keys to move it, R to rotate it, and + or − to adjust its size."],
      ["Record your own interpretation", "Before opening the Gallery, look back at your work and write why you placed the squares that way. The arrangement you reflect on becomes V1."],
      ["Reflect after the Gallery", "Flip Gallery cards to see how others interpreted the same concept. Then record what changed or stayed the same in your understanding. You can finish with V1 or save a new version."]
    ];

    function showTutorialStep(index) {
      tutorialStep = index;
      const [title, body] = tutorialPages[index];
      const heading = document.getElementById("tutorialTitle");
      document.getElementById("tutorialProgress").textContent = `Tutorial ${index + 1} of ${tutorialPages.length}`;
      heading.textContent = title;
      const p3Controls = isP3 && index === 1;
      const includePhoto = !isP3 && (mode === "inperson" || !tutorialFromWorkspace) && index === 1;
      document.getElementById("tutorialBody").textContent = includePhoto
        ? body + " For in-person work, arrange physical squares and add a photo or PDF."
        : p3Controls ? "Drag to move a square. Select it to see size and rotation controls. With a keyboard, use Tab to focus a square, arrow keys to move, [ or ] to rotate, and + or − to resize."
        : body;
      document.getElementById("tutorialBack").hidden = index === 0;
      document.getElementById("tutorialContinue").textContent = index === tutorialPages.length - 1
        ? (tutorialFromWorkspace ? "Return to Workspace" : isP3 ? "Start Creating" : "Choose Participation Mode")
        : "Continue";
      heading.focus();
    }

    function advanceTutorial() {
      if (tutorialStep === tutorialPages.length - 1) closeTutorial();
      else showTutorialStep(tutorialStep + 1);
    }

    function openTutorial() {
      const shell = document.getElementById("workspaceShell");
      tutorialFromWorkspace = !shell.hidden;
      shell.hidden = true;
      document.getElementById("entryGate").hidden = false;
      document.getElementById("resumeDraftBtn").hidden = true;
      if (!isP3) participantOptions.forEach(id => { document.getElementById(id).hidden = true; });
      document.getElementById("tutorial").hidden = false;
      showTutorialStep(0);
    }

    function closeTutorial() {
      document.getElementById("tutorial").hidden = true;
      if (tutorialFromWorkspace) {
        document.getElementById("entryGate").hidden = true;
        document.getElementById("workspaceShell").hidden = false;
        document.querySelector('#workspaceShell [data-click="open-tutorial"]').focus();
      } else if (isP3) {
        launchApp("online");
      } else {
        participantOptions.forEach(id => { document.getElementById(id).hidden = false; });
        refreshResumeButton();
        document.getElementById("modeHeading").focus();
      }
    }

    function chooseConcept(button) {
      selectedConcept = button.textContent.trim();
      document.getElementById("conceptPicker").hidden = true;
      if (!isP3) document.getElementById("modeHeading").textContent = selectedConcept + " — Choose how to participate";
      openTutorial();
    }

    function showConceptPicker() {
      document.getElementById("reviewTutorial").hidden = true;
      document.getElementById("modePicker").hidden = true;
      document.getElementById("modeHeading").hidden = true;
      document.getElementById("changeConcept").hidden = true;
      document.getElementById("conceptPicker").hidden = false;
      const bubbles = [...document.querySelectorAll(".concept-bubble")];
      (bubbles.find(button => button.textContent.trim() === selectedConcept) || bubbles[0]).focus();
    }

    const conceptIcons = Object.freeze({
      Balance: "M12 3v17m-5 0h10M4 7h16M5 7l-3 6h6L5 7Zm14 0-3 6h6l-3-6Z",
      Tension: "M5 19 19 5M5 13v6h6m2-14h6v6",
      Chaos: "M5 5h2v2H5zM16 9h2v2h-2zM8 14h2v2H8zM17 18h2v2h-2z",
      Order: "M4 4h16v16H4zM9.3 4v16m5.4-16v16M4 9.3h16M4 14.7h16"
    });

    function setLocalSaveStatus(state, message) {
      const indicator = document.getElementById("localSaveStatus");
      indicator.dataset.state = state;
      indicator.querySelector(".save-status-full").textContent = message;
      indicator.querySelector(".save-status-short").textContent = { saved: "Saved", idle: "Autosave", error: "Save failed" }[state];
    }

    function launchApp(selectedMode) {
      const concept = document.getElementById("conceptIndicator");
      concept.textContent = selectedConcept;
      if (isP3) {
        const icon = Object.hasOwn(conceptIcons, selectedConcept) ? conceptIcons[selectedConcept] : "";
        document.getElementById("conceptIcon").setAttribute("d", icon);
        concept.closest(".concept-chip").dataset.concept = selectedConcept;
      }
      mode = isP3 ? "online" : selectedMode;
      document.getElementById("entryGate").hidden = true;
      document.getElementById("workspaceShell").hidden = false;

      if (!isP3) {
        document.getElementById("modeIndicator").textContent = mode === "online" ? "Online Solo Mode" : "In-Person Assist";
      }
      startBlankSession();

    }

    function startBlankSession() {
      clearCanvasHistory();
      photoRequest++;
      explorations = [];
      reviewedArrangement = null;
      firstReflection = null;
      secondReflection = null;
      workingPhoto = "";
      galleryPostId = null;
      inspiration.clear();
      markedSample = null;
      savedSamples = [];
      variationSkipped = false;
      exportUnlocked = false;
      decisionRecorded = false;
      revisingDecision = false;
      compareRequested = false;
      document.getElementById("reflectionHelp").open = false;
      document.getElementById("draftStatus").textContent = "";
      activeSquareId = null;
      if (!isP3) {
        document.getElementById("galleryStatus").textContent = "";
        document.getElementById("galleryInterpretation").value = "";
        document.getElementById("compositionUpload").value = "";
        document.getElementById("compositionCamera").value = "";
        document.getElementById("photoStatus").textContent = "";
      }
      v1Locked = false;
      isWorkingDraftDirty = false;

      const defaultGrid = [
        { id: 1, x: 26, y: 26, rot: 0 },
        { id: 2, x: 56, y: 26, rot: 0 },
        { id: 3, x: 26, y: 56, rot: 0 },
        { id: 4, x: 56, y: 56, rot: 0 }
      ];

      choices = [{
        title: "V1: Baseline",
        source: "Locked Baseline",
        reflectionLink: "Initial baseline before the Gallery",
        note: "Initial arrangement.",
        immutable: false,
        squares: clone(defaultGrid)
      }];

      activeChoiceIdx = 0;
      keptChoiceIdx = 0;
      workingSquares = clone(defaultGrid);

      document.getElementById("goalField").value = "";
      document.getElementById("goalField").readOnly = false;
      document.getElementById("nextField").value = "";
      document.getElementById("nextField").readOnly = false;
      document.getElementById("understandingShiftField").value = "";
      document.getElementById("finalReasonField").value = "";
      document.getElementById("v1LockBadge").textContent = "In progress";
      document.getElementById("lockV1Btn").textContent = "Save & Open Gallery";

      document.getElementById("savedVersions").open = false;
      if (!isP3) {
        document.getElementById("galleryV1").open = false;
        const galleryV1Preview = document.getElementById("galleryV1Preview");
        galleryV1Preview.replaceChildren();
        delete galleryV1Preview.dataset.source;
      }
      hideDecisionExport();
      document.getElementById("v1GhostToggle").checked = false;
      validateStep1Gate();
      goToStep(1);
    }

    function saveExploration() {
      if (mode !== "online" || currentStep !== 1 || explorations.length >= EXPLORATION_COUNT) return;
      const layoutKey = squares => squares.map(square =>
        [square.x.toFixed(4), square.y.toFixed(4), ((square.rot % 90) + 90) % 90, squareSize(square)].join(",")).sort().join(";");
      const key = layoutKey(workingSquares);
      const status = document.getElementById("explorationStatus");
      if (explorations.some(squares => layoutKey(squares) === key)) {
        status.textContent = "You already saved this arrangement. Try moving or turning a square.";
        status.hidden = false;
        return;
      }
      explorations.push(clone(workingSquares));
      clearCanvasHistory();
      activeSquareId = null;
      goToStep(explorations.length === EXPLORATION_COUNT ? 1.1 : 1);
      if (!persistSessionState() && currentStep === 1) {
        status.textContent = "This arrangement is available in this tab. Browser storage is unavailable.";
        status.hidden = false;
      }
    }

    function explorationThumbnail(squares) {
      const preview = document.createElement("span");
      preview.className = "canvas-frame";
      preview.setAttribute("aria-hidden", "true");
      squares.forEach(square => {
        const tile = document.createElement("span");
        tile.className = "square-node";
        placeSquare(tile, square);
        preview.append(tile);
      });
      return preview;
    }

    function renderExplorationProgress() {
      const count = explorations.length;
      document.getElementById("explorationProgress").hidden = count === 0;
      document.getElementById("explorationCount").textContent =
        count + (count === 1 ? " arrangement saved" : " arrangements saved");
      document.getElementById("explorationThumbnails").replaceChildren(...explorations.map((squares, index) => {
        const item = document.createElement("li");
        const caption = document.createElement("span");
        caption.className = "meta-note";
        caption.textContent = "Arrangement " + (index + 1);
        item.append(explorationThumbnail(squares), caption);
        return item;
      }));
    }

    function renderExplorationReview() {
      const list = document.getElementById("explorationList");
      document.getElementById("explorationReviewPrompt").textContent =
        v1Locked ? "Review your six arrangements. Your selected V1 is marked."
          : `Look across your arrangements and pick one to carry forward.`;
      list.replaceChildren();
      explorations.forEach((squares, index) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        const caption = document.createElement("span");
        button.type = "button";
        button.disabled = v1Locked;
        button.className = "btn exploration-option";
        caption.textContent = "Arrangement " + (index + 1) + (v1Locked && index === reviewedArrangement ? " · V1" : "");
        button.append(explorationThumbnail(squares), caption);
        button.setAttribute("aria-pressed", String(index === reviewedArrangement));
        button.addEventListener("click", () => {
          if (reviewedArrangement !== index) {
            document.getElementById("goalField").value = "";
            document.getElementById("nextField").value = "";
          }
          reviewedArrangement = index;
          workingSquares = clone(squares);
          goToStep(1.25);
          persistSessionState();
        });
        item.appendChild(button);
        list.appendChild(item);
      });
      validateStep1Gate();
    }

    function validateStep1Gate() {
      if (!isP3) document.getElementById("inPersonReflectBtn").disabled = !workingPhoto;
      const hasGoal = document.getElementById("goalField").value.trim().length > 0;
      document.getElementById("lockV1Btn").disabled = !hasGoal || (mode === "inperson" && !workingPhoto);
    }

    function lockBaselineV1() {
      if (!v1Locked) {
        if (document.getElementById("lockV1Btn").disabled) return;
        firstReflection = {
          text: document.getElementById("goalField").value.trim(),
          next: document.getElementById("nextField").value.trim()
        };
        choices[0].photo = workingPhoto;
        choices[0].squares = clone(workingSquares);
        choices[0].title = "V1: Original";
        choices[0] = freezeV1Choice(choices[0]);
        v1Locked = true;
        isWorkingDraftDirty = false;
        document.getElementById("goalField").readOnly = true;
        document.getElementById("nextField").readOnly = true;
        document.getElementById("v1LockBadge").textContent = "Saved";
        document.getElementById("lockV1Btn").textContent = "Open Gallery";
      }
      activeChoiceIdx = 0;
      persistSessionState();
      goToStep(1.5);
    }

    function validateStep2Gate() {
      const hasResponse = Boolean(document.getElementById("understandingShiftField").value.trim());
      if (!hasResponse) document.getElementById("reflectionNext").hidden = true;
      const nextVisible = !document.getElementById("reflectionNext").hidden;
      const continueButton = document.getElementById("continueReflectionBtn");
      continueButton.disabled = !hasResponse;
      continueButton.hidden = nextVisible || (isP3 && Boolean(secondReflection) && !revisingDecision);
      updateMobileSteps();
    }

    function showReflectionNext() {
      if (document.getElementById("continueReflectionBtn").disabled) return;
      document.getElementById("reflectionNext").hidden = false;
      validateStep2Gate();
      document.getElementById("reflectionNextTitle").focus();
    }

    function finishReflection(redesign) {
      const text = document.getElementById("understandingShiftField").value.trim();
      if (!text) {
        document.getElementById("understandingShiftField").focus();
        return;
      }
      if (isP3) {
        variationSkipped = !redesign;
        exportUnlocked = exportUnlocked || !redesign;
        decisionRecorded = false;
        revisingDecision = false;
      }
      secondReflection = { text, inspiration: [...inspiration] };
      compareRequested = false;
      if (!redesign) keptChoiceIdx = 0;
      goToStep(redesign ? 3 : 4);
      persistSessionState();
    }

    const mobileLayout = window.matchMedia("(max-width: 767px)");
    const mobileProgress = document.querySelector(".mobile-progress");
    const mobileStepList = document.getElementById("mobileStepList");

    function updateMobileSteps() {
      const reflectionReady = !document.getElementById("reflectionNext").hidden;
      const availableSteps = {
        1: true,
        1.25: reviewedArrangement !== null || v1Locked,
        1.5: v1Locked,
        2: v1Locked,
        3: currentStep === 2 ? reflectionReady : Boolean(secondReflection),
        4: currentStep === 2 ? reflectionReady && Boolean(secondReflection) : Boolean(secondReflection)
      };
      const activeStep = currentStep === 1.1 || (!isP3 && currentStep === 1.25) ? 1 : currentStep;
      for (const button of mobileProgress.querySelectorAll("[data-step]")) {
        const step = Number(button.dataset.step);
        const active = step === activeStep;
        button.disabled = !active && !availableSteps[step];
        if (active) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      }
      if (isP3) {
        const labels = {1: "1 of 5 · Create", 1.1: "1 of 5 · Pick V1", 1.25: "2 of 5 · Reflect before Gallery",
          1.5: "3 of 5 · Explore Gallery", 2: "4 of 5 · Reflect & Decide", 3: "4 of 5 · Try a variation", 4: "5 of 5 · Compare & Export"};
        document.getElementById("mobileStageLabel").textContent = "Step " + labels[currentStep];
        const label = variationSkipped ? "Variation skipped (optional)" : "Try a variation (optional)";
        for (const button of document.querySelectorAll('[data-click="navigate-p3-step"]')) {
          const step = Number(button.dataset.step);
          const active = step === activeStep;
          button.disabled = active || !canVisitP3Step(step);
          if (active) button.setAttribute("aria-current", "step");
          else button.removeAttribute("aria-current");
          if (step === 3) {
            button.closest("li").hidden = currentStep < 2 && !secondReflection;
            button.textContent = variationSkipped ? "Skipped" : "+ Variation";
            button.setAttribute("aria-label", label);
          }
        }
        return;
      }
      const showsComparison = mode === "online" && choices.length > 1 &&
        (currentStep !== 4 || compareRequested);
      mobileProgress.querySelector('[data-step="4"]').textContent =
        showsComparison ? "4. Compare & Export" : "4. Summary & Export";
    }

    function revealMobileStep() {
      const active = mobileStepList.querySelector('[aria-current="step"]');
      if (!mobileLayout.matches || !active) return;
      const listBounds = mobileStepList.getBoundingClientRect();
      const buttonBounds = active.getBoundingClientRect();
      if (buttonBounds.left < listBounds.left || buttonBounds.right > listBounds.right) {
        mobileStepList.scrollLeft += buttonBounds.left - listBounds.left -
          (listBounds.width - buttonBounds.width) / 2;
      }
    }

    mobileLayout.addEventListener("change", revealMobileStep);
    mobileLayout.addEventListener("change", orderWalkthroughControls);

    function orderWalkthroughControls() {
      const previousFocus = document.activeElement;
      const tutorialContinue = document.getElementById("tutorialContinue");
      const tutorialBack = document.getElementById("tutorialBack");
      if (mobileLayout.matches) tutorialBack.before(tutorialContinue);
      else tutorialBack.after(tutorialContinue);
      if (!isP3) {
        const modePicker = document.getElementById("modePicker");
        const secondaryActions = document.getElementById("modeSecondaryActions");
        if (mobileLayout.matches) modePicker.after(secondaryActions);
        else modePicker.before(secondaryActions);
      }

      if (document.activeElement !== previousFocus) previousFocus?.focus({ preventScroll: true });
    }

    function navigateMobileStep(step) {
      const button = mobileProgress.querySelector(`[data-step="${step}"]`);
      if (!button || button.disabled) return;
      if (button.hasAttribute("aria-current")) {
        if (currentStep === 1.25 && !v1Locked) goToStep(usesExploration() ? 1.1 : 1);
        return;
      }
      if (step === 4 && currentStep === 3) {
        proceedToComparison();
        return;
      }
      if (currentStep === 3 && isWorkingDraftDirty) {
        if (!window.confirm("Leave this step and discard the unsaved arrangement?")) return;
        discardWorkingDraft();
      }
      if (currentStep === 2 && step === 3) {
        finishReflection(true);
        return;
      }
      if (currentStep === 2 && step === 4) {
        if (isP3) variationSkipped = true;
        secondReflection = {
          text: document.getElementById("understandingShiftField").value.trim(),
          inspiration: [...inspiration]
        };
        proceedToComparison();
        return;
      }
      if (step === 1 && v1Locked) {
        activeChoiceIdx = 0;
        workingSquares = clone(choices[0].squares);
        workingPhoto = choices[0].photo || "";
        goToStep(1.25);
        return;
      }
      goToStep(step);
    }

    function canVisitP3Step(step) {
      switch (step) {
        case 1: return true;
        case 1.25: return reviewedArrangement !== null || v1Locked;
        case 1.5:
        case 2: return v1Locked;
        case 3: return Boolean(secondReflection) && !variationSkipped;
        case 4: return exportUnlocked;
        default: return false;
      }
    }

    function navigateP3Step(step) {
      if (!canVisitP3Step(step)) return;
      if (currentStep === 3 && isWorkingDraftDirty) {
        document.getElementById("versionSaveStatus").textContent = "Save or discard the draft before switching steps.";
        return;
      }
      if (step === 1.25 && v1Locked) {
        activeChoiceIdx = 0;
        workingSquares = clone(choices[0].squares);
      }
      goToStep(step === 1 && v1Locked ? 1.1 : step);
      persistSessionState();
    }

    function reviseReflectionDecision() {
      revisingDecision = true;
      const response = document.getElementById("understandingShiftField");
      response.readOnly = false;
      document.getElementById("reviseDecisionBtn").hidden = true;
      document.getElementById("reviewDecisionStatus").hidden = true;
      document.getElementById("reflectionNext").hidden = false;
      validateStep2Gate();
      response.focus();
    }

    function goToStep(stepNumber) {
      if ((stepNumber >= 1.5 && !v1Locked) ||
          (stepNumber === 1.25 && mode === "inperson" && !workingPhoto)) {
        validateStep1Gate();
        return;
      }
      if (usesExploration() && !v1Locked) {
        if (stepNumber === 1 && explorations.length === EXPLORATION_COUNT) stepNumber = 1.1;
        if (stepNumber === 1.1 && explorations.length < EXPLORATION_COUNT) return;
        if (stepNumber === 1.25 && reviewedArrangement === null) return;
      }
      if (currentStep !== stepNumber) {
        clearCanvasHistory();
        if (isP3) revisingDecision = false;
      }
      currentStep = stepNumber;

      [1, 2, 3, 4].forEach(n => {
        const navItem = document.getElementById(`stepNav${n}`);
        if (n === currentStep || (n === 1 && (currentStep === 1.1 || (!isP3 && currentStep === 1.25)))) {
          navItem.setAttribute("aria-current", "step");
        } else {
          navItem.removeAttribute("aria-current");
        }
      });

      if (isP3) {
        const pre = document.getElementById("stepNavPre");
        if (currentStep === 1.25) pre.setAttribute("aria-current", "step");
        else pre.removeAttribute("aria-current");
      }
      const isGallery = currentStep === 1.5;
      const galleryNav = document.getElementById("stepNavGallery");
      if (isGallery) galleryNav.setAttribute("aria-current", "step");
      else galleryNav.removeAttribute("aria-current");
      document.getElementById("galleryPage").hidden = !isGallery;

      document.getElementById("contextPanel").hidden = isGallery;
      const inPerson = mode === "inperson";
      const isCompare = currentStep === 4 && !inPerson && compareRequested && choices.length > 1;
      const isSummary = currentStep === 4 && !isCompare;
      const isCreation = currentStep === 1;
      const onlineCreation = !inPerson && isCreation;
      const isReview = !inPerson && currentStep === 1.1;
      document.getElementById("stageSection").hidden = isGallery || isSummary || isReview;
      document.getElementById("contextPanel").classList.toggle("exploration-review-screen", isReview);
      document.getElementById("onlineCreatePanel").hidden = !onlineCreation;
      if (isP3) {
        document.getElementById("explorationStatus").hidden = true;
        if (onlineCreation) renderExplorationProgress();
        document.getElementById("explorationReview").hidden = !isReview;
        if (isReview) renderExplorationReview();
      }
      document.getElementById("onlineCreateTitle").textContent =
        explorations.length ? "Try Another Arrangement" : "Make a Composition";
      if (!isP3) document.getElementById("inPersonCreatePanel").hidden = !(inPerson && isCreation);
      document.getElementById("onlineCreateHint").textContent =
        `Arrange four squares to express ${selectedConcept}. Try changing a gap or letting a square extend past the frame.`;
      if (!isP3) document.getElementById("stepNav4").textContent = inPerson || choices.length < 2 || isSummary ? "4. Summary & Export" : "4. Compare & Export";
      document.getElementById("finalReasonLabel").textContent = !isCompare
        ? "Why did you keep this arrangement? (Optional)"
        : "Why keep this version over the other saved choices?";
      if (!isP3) document.getElementById("finalReasonField").placeholder = !isCompare ? "" : "What helped you choose?";
      document.getElementById("finishVariationsBtn").textContent = inPerson || choices.length < 2 ? "View Summary" : "Compare Versions";
      document.getElementById("contextPanel").classList.toggle("summary-only", isSummary);
      document.getElementById("workspaceShell").classList.toggle("reflection-screen", currentStep === 2 || currentStep === 1.25);
      document.getElementById("stageSection").classList.toggle("wide", isCompare);
      document.getElementById("canvasView").hidden = isCompare;
      document.getElementById("compareView").hidden = !isCompare;

      document.getElementById("step1Title").textContent = currentStep === 1.25 ? (isP3 ? "2. Reflect Before Gallery" : "Reflection 1") : "Make Your First Composition";
      document.getElementById("panelStep1").hidden = currentStep !== 1.25;
      document.getElementById("panelStep2").hidden = currentStep !== 2;
      document.getElementById("panelStep3").hidden = currentStep !== 3;
      document.getElementById("panelStep4").hidden = currentStep !== 4;

      document.getElementById("ghostToolbar").hidden = currentStep < 2;
      document.getElementById("choicesTray").hidden = currentStep !== 3;

      syncPhotoWorkspace();
      if (isGallery) renderGallery();
      if (currentStep === 2) {
        if (isP3) {
          const reviewing = Boolean(secondReflection) && !revisingDecision;
          const response = document.getElementById("understandingShiftField");
          response.readOnly = reviewing;
          if (reviewing) response.value = secondReflection.text;
          document.getElementById("reviseDecisionBtn").hidden = !reviewing;
          const status = document.getElementById("reviewDecisionStatus");
          status.hidden = !reviewing;
          status.textContent = variationSkipped ? "You chose to keep V1." : "You chose to explore a variation.";
        }
        workingSquares = clone(choices[0].squares);
        workingPhoto = choices[0].photo || "";
        activeChoiceIdx = 0;
        syncPhotoWorkspace();
        document.getElementById("reflectionNext").hidden = true;
        validateStep2Gate();
        renderReflectionReference();
      }
      if (currentStep === 3) {
        const shiftText = document.getElementById("understandingShiftField").value.trim();
        document.getElementById("activeReflectionSummary").textContent =
          shiftText || "No reflection recorded.";
        renderChoicesList();
      } else if (currentStep === 4) {
        document.getElementById("decisionPanel").hidden = true;
        document.getElementById("continueDecisionBtn").hidden = isCompare;
        document.getElementById("selectedSummaryBadge").hidden = isCompare;
        hideDecisionExport();
        document.getElementById("journeyBefore").textContent = firstReflection?.text || "";
        document.getElementById("journeyAfter").textContent = secondReflection?.text || "";
        if (isP3) renderJourneyReferences();
        if (isCompare) renderCompareGallery();
        if (isP3 && decisionRecorded) {
          document.getElementById("continueDecisionBtn").hidden = true;
          document.getElementById("selectedSummaryBadge").hidden = false;
          document.getElementById("decisionPanel").hidden = false;
          if (isCompare) renderCompareGallery();
          recordDecisionLog(false);
        }
        if (!isCompare) document.getElementById("selectedSummaryBadge").textContent =
          `Kept: ${choices[keptChoiceIdx]?.title || "V1"}`;
      }

      validateStep1Gate();
      updateDraftStatusUI();
      renderBoard();
      const heading = document.getElementById(isGallery ? "galleryTitle"
        : isCreation ? (onlineCreation ? "onlineCreateTitle" : "inPersonCreateTitle")
        : isReview ? "explorationReviewTitle"
        : currentStep === 1.25 ? "step1Title" : `step${currentStep}Title`);
      heading.tabIndex = -1;
      updateMobileSteps();
      if (mobileLayout.matches) {
        heading.focus({ preventScroll: true });
        window.scrollTo(0, 0);
        revealMobileStep();
      } else {
        heading.focus();
      }
    }

    function proceedToComparison() {
      if (isWorkingDraftDirty) {
        const confirmSave = window.confirm(
          "You have unsaved changes on the board (Working Draft). Save them as a new version before continuing?"
        );
        if (confirmSave) {
          storeNewChoice();
        } else {
          discardWorkingDraft();
        }
      }
      compareRequested = mode === "online" && choices.length > 1;
      if (isP3) exportUnlocked = true;
      goToStep(4);
      persistSessionState();
    }

    function updateDraftStatusUI() {
      const baseChoice = choices[activeChoiceIdx];
      isWorkingDraftDirty = Boolean(baseChoice && (
        workingPhoto !== (baseChoice.photo || "") ||
        (!workingPhoto && !squaresEqual(workingSquares, baseChoice.squares))
      ));

      const pending = v1Locked && isWorkingDraftDirty;
      const saveButton = document.getElementById("saveNewVersionBtn");
      saveButton.disabled = !pending;
      if (currentStep === 3) {
        document.getElementById("finishVariationsBtn").textContent =
          mode === "online" && choices.length > 1 ? "Compare Versions" : "View Summary";
      }
      document.getElementById("discardDraftBtn").hidden = !pending;
      document.getElementById("versionSaveStatus").textContent = pending ? "Unsaved changes" : "";
    }

    function confirmDiscardWorkingDraft() {
      if (isWorkingDraftDirty && window.confirm("Discard all unsaved changes to this arrangement?")) {
        discardWorkingDraft();
      }
    }

    function discardWorkingDraft() {
      clearCanvasHistory();
      workingSquares = clone(choices[activeChoiceIdx].squares);
      workingPhoto = choices[activeChoiceIdx].photo || "";
      syncPhotoWorkspace();
      updateDraftStatusUI();
      renderBoard();
      if (isP3) persistSessionState();
    }

    function renderChoicesList() {
      const list = document.getElementById("choicesList");
      list.replaceChildren();

      choices.forEach((ch, idx) => {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "choice-btn";
        if (idx === activeChoiceIdx) btn.setAttribute("aria-current", "true");
        btn.addEventListener("click", () => selectChoice(idx));

        const titleStrong = document.createElement("strong");
        titleStrong.textContent = ch.title;

        btn.appendChild(titleStrong);
        li.appendChild(btn);
        list.appendChild(li);
      });
    }

    function selectChoice(idx) {
      if (isWorkingDraftDirty) {
        const discard = window.confirm("Discard unsaved working draft changes and switch version?");
        if (!discard) return;
      }
      clearCanvasHistory();
      activeChoiceIdx = idx;
      workingSquares = clone(choices[idx].squares);
      workingPhoto = choices[idx].photo || "";
      syncPhotoWorkspace();
      updateDraftStatusUI();
      renderChoicesList();
      renderBoard();
    }

    function storeNewChoice() {
      if (!isWorkingDraftDirty) return;
      const vNum = choices.length + 1;
      const title = `V${vNum}`;
      const shiftText = document.getElementById("understandingShiftField").value.trim();

      choices.push({
        title: title,
        source: workingPhoto ? "Photo or PDF" : "Digital Canvas",
        reflectionLink: shiftText || "Exploration",
        note: "",
        photo: workingPhoto,
        immutable: false,
        squares: clone(workingSquares)
      });

      activeChoiceIdx = choices.length - 1;
      keptChoiceIdx = activeChoiceIdx;
      isWorkingDraftDirty = false;
      updateDraftStatusUI();
      renderChoicesList();
      updateMobileSteps();
      const saved = persistSessionState();
      document.getElementById("versionSaveStatus").textContent = saved ? `${title} saved` : `${title} added. Export to keep a copy.`;
    }

    function renderBoard() {
      document.getElementById("board").classList.toggle("is-editable", canModifyBoard());
      const container = document.getElementById("squaresContainer");
      container.querySelectorAll(".square-ghost").forEach(el => el.remove());

      const showGhost = document.getElementById("v1GhostToggle").checked && currentStep >= 2;
      if (showGhost && choices.length > 0) {
        choices[0].squares.forEach(sq => {
          const ghost = document.createElement("div");
          ghost.className = "square-ghost";
          placeSquare(ghost, sq);
          ghost.textContent = "V1";
          container.insertBefore(ghost, container.firstChild);
        });
      }

      workingSquares.forEach(sq => {
        let btn = squareButtonMap.get(sq.id);
        if (!btn) {
          btn = document.createElement("button");
          btn.type = "button";
          btn.className = "square-node";
          btn.textContent = `#${sq.id}`;
          for (const corner of Object.keys(resizeCornerAngles)) {
            const handle = document.createElement("span");
            handle.className = "square-resize-handle";
            handle.dataset.corner = corner;
            handle.setAttribute("aria-hidden", "true");
            btn.append(handle);
          }
          btn.addEventListener("contextmenu", (e) => { if (canModifyBoard()) e.preventDefault(); });
          btn.addEventListener("click", (e) => {
            if (e.detail === 0 && canModifyBoard()) {
              activeSquareId = sq.id;
              renderBoard();
            }
          });
          if (isP3) btn.addEventListener("focus", () => {
            if (!canModifyBoard() || activeSquareId === sq.id) return;
            activeSquareId = sq.id;
            renderBoard();
          });
          btn.addEventListener("keydown", (e) => handleSquareKeydown(e, sq.id));
          squareButtonMap.set(sq.id, btn);
          container.appendChild(btn);
        }

        btn.setAttribute(
          "aria-label",
          `Square ${sq.id}, X ${Math.round(sq.x)}%, Y ${Math.round(sq.y)}%, tilt ${sq.rot} degrees, side ${squareSize(sq)} percent of board`
        );
        btn.tabIndex = canModifyBoard() ? 0 : -1;
        btn.setAttribute("aria-pressed", String(sq.id === activeSquareId));
        placeSquare(btn, sq);
      });

      updateTiltToolbar();
      if (isP3) updateCanvasHistoryControls();
    }

    function clearCanvasHistory() {
      sliderEdit = null;
      undoStack.length = 0;
      redoStack.length = 0;
      if (isP3) document.getElementById("canvasHistoryStatus").textContent = "";
    }

    function commitSquareEdit(square, nextSquare) {
      if (squaresEqual([square], [nextSquare])) return;
      if (isP3) {
        undoStack.push(clone(workingSquares));
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        redoStack.length = 0;
        document.getElementById("canvasHistoryStatus").textContent = "";
      }
      Object.assign(square, nextSquare);
      updateDraftStatusUI();
      if (isP3) persistSessionState();
    }

    function updateCanvasHistoryControls() {
      document.getElementById("canvasEditControls").hidden = !canModifyBoard();
      document.getElementById("undoCanvasBtn").setAttribute("aria-disabled", String(!undoStack.length));
      document.getElementById("redoCanvasBtn").setAttribute("aria-disabled", String(!redoStack.length));
    }

    function restoreCanvasEdit(reapply) {
      if (!canModifyBoard() || squareGesture || sliderEdit) return;
      const from = reapply ? redoStack : undoStack;
      const to = reapply ? undoStack : redoStack;
      if (!from.length) return;
      to.push(clone(workingSquares));
      workingSquares = from.pop();
      if (isP3) persistSessionState();
      updateDraftStatusUI();
      renderBoard();
      document.getElementById("canvasHistoryStatus").textContent =
        reapply ? "Canvas edit redone." : "Canvas edit undone.";
    }

    if (isP3) document.getElementById("workspaceShell").addEventListener("keydown", event => {
      if (!canModifyBoard() || squareGesture || event.altKey || !(event.metaKey || event.ctrlKey) ||
          event.target.closest("textarea, input:not([type=range]), select, [contenteditable]") ||
          event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      restoreCanvasEdit(event.shiftKey);
    });

    function canModifyBoard() {
      return (currentStep === 1 && !v1Locked) || (currentStep === 3 && !workingPhoto);
    }

    const gestureBoard = document.getElementById("board");

    // Embedded iOS browsers may scroll on a touch drag despite touch-action.
    // Cancel only moves initiated on editable squares; keep taps and page scrolling native.
    if (isP3) gestureBoard.addEventListener("touchmove", event => {
      if (!event.cancelable || !canModifyBoard()) return;
      const startedOnSquare = Array.from(event.targetTouches).some(touch =>
        touch.target instanceof Element && touch.target.closest("#board button.square-node")
      );
      if (startedOnSquare || squareGesture?.pointerType === "touch") event.preventDefault();
    }, { passive: false });


    function pointerDistance(points) {
      const [a, b] = points.values();
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    gestureBoard.addEventListener("pointerdown", e => {
      if (!canModifyBoard() || e.button !== 0) return;
      const point = { x: e.clientX, y: e.clientY };
      if (squareGesture) {
        const gesture = squareGesture;
        if (e.pointerType !== "touch" || gesture.pointerType !== "touch" || gesture.points.size !== 1) return;
        e.preventDefault();
        gesture.points.set(e.pointerId, point);
        gesture.kind = "pinch";
        gesture.pinchBase = clone(gesture.preview);
        gesture.distance = Math.max(8, pointerDistance(gesture.points));
        gesture.button.setPointerCapture(e.pointerId);
        return;
      }

      const button = e.target.closest("button.square-node");
      const square = workingSquares.find(sq => squareButtonMap.get(sq.id) === button);
      if (!square || !gestureBoard.clientWidth || !gestureBoard.clientHeight) return;
      const handle = !isP3 && e.pointerType === "touch" ? null : e.target.closest(".square-resize-handle");
      const cornerAngle = handle ? resizeCornerAngles[handle.dataset.corner] : undefined;
      e.preventDefault();
      activeSquareId = square.id;
      squareGesture = {
        kind: cornerAngle === undefined ? "move" : "corner", cornerAngle,
        pointerType: e.pointerType, square, button,
        origin: point, points: new Map([[e.pointerId, point]]), preview: clone(square),
        width: gestureBoard.clientWidth, height: gestureBoard.clientHeight, moved: false
      };
      button.setPointerCapture(e.pointerId);
      renderBoard();
    });

    function updateSquareGesture(e) {
      const g = squareGesture;
      if (!g?.points.has(e.pointerId) || !canModifyBoard() || !workingSquares.includes(g.square)) return;
      g.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const preview = clone(g.kind === "pinch" ? g.pinchBase : g.square);
      if (g.kind === "pinch") {
        setSquareSize(preview, squareSize(g.pinchBase) * pointerDistance(g.points) / g.distance);
      } else {
        const dx = e.clientX - g.origin.x, dy = e.clientY - g.origin.y;
        if (!g.moved && Math.hypot(dx, dy) <= (g.kind === "corner" ? 1 : 5)) return;
        g.moved = true;
        if (g.kind === "corner") {
          const diagonal = (g.square.rot + g.cornerAngle) * Math.PI / 180;
          const projected = dx * 100 / g.width * Math.cos(diagonal) + dy * 100 / g.height * Math.sin(diagonal);
          setSquareSize(preview, squareSize(g.square) + projected * Math.SQRT2);
        } else {
          Object.assign(preview, constrainSquarePosition(g.square, g.square.x + Math.round(dx * 100 / g.width),
            g.square.y + Math.round(dy * 100 / g.height)));
        }
      }
      g.preview = preview;
      placeSquare(g.button, preview);
    }

    function finishSquareGesture(e, canceled = false) {
      const g = squareGesture;
      if (!g?.points.has(e.pointerId)) return;
      if (!canceled && canModifyBoard() && workingSquares.includes(g.square)) {
        updateSquareGesture(e);
        commitSquareEdit(g.square, g.preview);
        if (g.pointerType === "mouse") g.button.focus({ preventScroll: true });
      }
      squareGesture = null;
      for (const id of g.points.keys()) {
        if (g.button.hasPointerCapture(id)) g.button.releasePointerCapture(id);
      }
      renderBoard();
    }

    window.addEventListener("pointermove", updateSquareGesture);
    window.addEventListener("pointerup", e => finishSquareGesture(e));
    window.addEventListener("pointercancel", e => finishSquareGesture(e, true));
    gestureBoard.addEventListener("lostpointercapture", e => finishSquareGesture(e, true));

    function handleSquareKeydown(e, id) {
      const sq = workingSquares.find(s => s.id === id);
      if (!sq || !canModifyBoard() || e.ctrlKey || e.metaKey || e.altKey || squareGesture) return;

      const next = { ...sq };
      const step = e.shiftKey ? 5 : 2;
      if (e.key === "ArrowLeft") next.x -= step;
      else if (e.key === "ArrowRight") next.x += step;
      else if (e.key === "ArrowUp") next.y -= step;
      else if (e.key === "ArrowDown") next.y += step;
      else if (e.key === "+" || e.key === "=") resizeSquare(next, 1);
      else if (e.key === "-" || e.key === "_") resizeSquare(next, -1);
      else if (isP3 && e.key === "[") next.rot = Math.max(-45, next.rot - 15);
      else if (isP3 && e.key === "]") next.rot = Math.min(45, next.rot + 15);
      else if (e.key === "r" || e.key === "R") next.rot = ((next.rot + 15 + 45) % 90) - 45;
      else return;

      e.preventDefault();
      Object.assign(next, constrainSquarePosition(next, next.x, next.y));
      activeSquareId = id;
      commitSquareEdit(sq, next);
      renderBoard();
    }

    function onBoardBackgroundTap(e) {
      if (e.target.id === "board" || e.target.id === "squaresContainer") {
        activeSquareId = null;
        renderBoard();
      }
    }

    if (isP3) {
      for (const id of ["squareAngle", "squareScale"]) {
        const slider = document.getElementById(id);
        const isAngle = id === "squareAngle";
        if (!isAngle) {
          slider.min = MIN_SQUARE_SIZE / DEFAULT_SQUARE_SIZE * 100;
          slider.max = MAX_SQUARE_SIZE / DEFAULT_SQUARE_SIZE * 100;
          slider.style.setProperty("--tick", (100 - slider.min) / (slider.max - slider.min) * 100 + "%");
        }
        const finish = () => {
          if (sliderEdit?.slider !== slider) return;
          const { square, next } = sliderEdit;
          sliderEdit = null;
          if (canModifyBoard() && workingSquares.includes(square) && activeSquareId === square.id) {
            commitSquareEdit(square, next);
          }
          renderBoard();
        };
        slider.addEventListener("input", () => {
          const square = workingSquares.find(item => item.id === activeSquareId);
          if (!square || !canModifyBoard() || squareGesture) return;
          const next = { ...square };
          const raw = Number(slider.value);
          if (isAngle) next.rot = Math.abs(raw) <= 4 ? 0 : raw;
          else {
            const scale = Math.abs(raw - 100) <= 4 ? 100 : Math.round(raw / 5) * 5;
            const size = raw === Number(slider.min) ? MIN_SQUARE_SIZE
              : raw === Number(slider.max) ? MAX_SQUARE_SIZE : scale * DEFAULT_SQUARE_SIZE / 100;
            setSquareSize(next, size);
          }
          sliderEdit = { slider, square, next };
          placeSquare(squareButtonMap.get(square.id), next);
          showSquareValues(next, slider);
        });
        slider.addEventListener("change", finish);
        slider.addEventListener("blur", finish);
        slider.addEventListener("pointercancel", () => {
          if (sliderEdit?.slider !== slider) return;
          sliderEdit = null;
          renderBoard();
        });
        slider.addEventListener("keydown", event => {
          const delta = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
          if (!delta) return;
          event.preventDefault();
          finish();
          const square = workingSquares.find(item => item.id === activeSquareId);
          if (!square || !canModifyBoard() || squareGesture) return;
          const next = { ...square };
          const step = isAngle ? (event.shiftKey ? 15 : 1) : (event.shiftKey ? 10 : 5);
          if (isAngle) next.rot = Math.max(-45, Math.min(45, square.rot + delta * step));
          else setSquareSize(next, squareSize(square) + DEFAULT_SQUARE_SIZE * delta * step / 100);
          commitSquareEdit(square, next);
          renderBoard();
        });
      }
    }

    function showSquareValues(square, previewSlider) {
      const values = [
        ["squareAngle", "tiltReadout", square.rot, "°"],
        ["squareScale", "squareSizeReadout", squareSize(square) / DEFAULT_SQUARE_SIZE * 100, "%"]
      ];
      for (const [inputId, outputId, value, unit] of values) {
        const input = document.getElementById(inputId);
        const label = Math.round(value) + unit;
        if (input !== previewSlider) input.value = value;
        input.setAttribute("aria-valuetext", label);
        document.getElementById(outputId).value = label;
      }
      document.getElementById("resetSquareAngle").setAttribute("aria-disabled", String(square.rot === 0));
    }

    function updateTiltToolbar() {
      const bar = document.getElementById("tiltControl");
      const sq = canModifyBoard() && workingSquares.find(s => s.id === activeSquareId);
      if (isP3) {
        document.getElementById("squareEditFields").hidden = !sq;
        document.getElementById("squareEditHint").hidden = Boolean(sq);
        bar.classList.toggle("is-empty", !sq);
        if (sq) {
          const badge = document.getElementById("squareEditLabel");
          badge.textContent = `#${sq.id}`;
          badge.setAttribute("aria-label", `Selected square ${sq.id}`);
          showSquareValues(sq);
        }
        return;
      }
      bar.hidden = !sq;
      if (!sq) return;
      const size = squareSize(sq);
      document.getElementById("tiltReadout").value = `${sq.rot}°`;
      bar.style.left = `${Math.max(18, Math.min(82, sq.x + size / 2))}%`;
      bar.style.top = `${sq.y > 12 ? sq.y - 9 : sq.y + size + 3}%`;
    }

    function rotateActiveSquare(delta, event) {
      if (!canModifyBoard() || squareGesture) return;
      const sq = workingSquares.find(s => s.id === activeSquareId);
      if (!sq) return;
      const next = { ...sq, rot: Math.max(-45, Math.min(45, sq.rot + delta)) };
      Object.assign(next, constrainSquarePosition(next, next.x, next.y));
      commitSquareEdit(sq, next);
      renderBoard();
      if (event?.detail === 0) event.currentTarget.focus({ preventScroll: true });
    }

    function resetActiveTilt(event) {
      if (!canModifyBoard() || squareGesture || event?.currentTarget.getAttribute("aria-disabled") === "true") return;
      const sq = workingSquares.find(s => s.id === activeSquareId);
      if (!sq) return;
      const next = { ...sq, rot: 0 };
      Object.assign(next, constrainSquarePosition(next, next.x, next.y));
      commitSquareEdit(sq, next);
      renderBoard();
      if (event?.detail === 0) event.currentTarget.focus({ preventScroll: true });
    }

    function renderCompareGallery() {
      const grid = document.getElementById("compareGalleryGrid");
      grid.replaceChildren();
      document.getElementById("compareCountBadge").textContent = `Comparing ${choices.length} Saved Versions`;

      const showOverlay = document.getElementById("galleryGhostToggle").checked;

      choices.forEach((ch, idx) => {
        const isKept = idx === keptChoiceIdx && !document.getElementById("decisionPanel").hidden;
        const article = document.createElement("article");
        article.className = `compare-item glass-card ${isKept ? "is-selected" : ""}`;

        const head = document.createElement("header");
        head.className = "compare-item-head";
        const strong = document.createElement("strong");
        strong.textContent = ch.title;
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = ch.source;
        head.appendChild(strong);
        head.appendChild(badge);

        const miniBoard = document.createElement("div");
        miniBoard.className = "canvas-frame";
        miniBoard.setAttribute("aria-label", `${ch.title} preview`);

        if (showOverlay && idx > 0 && !ch.photo && !choices[0].photo) {
          choices[0].squares.forEach(sq => {
            const g = document.createElement("div");
            g.className = "square-ghost";
            placeSquare(g, sq);
            g.textContent = "V1";
            miniBoard.appendChild(g);
          });
        }

        if (ch.photo) miniBoard.append(photoPreview(ch.photo));
        else ch.squares.forEach(sq => {
          const s = document.createElement("div");
          s.className = "square-node";
          placeSquare(s, sq);
          s.style.cursor = "default";
          s.textContent = `#${sq.id}`;
          miniBoard.appendChild(s);
        });

        const reflectMeta = document.createElement("p");
        reflectMeta.className = "meta-note";
        reflectMeta.textContent = `Reflection link: ${ch.reflectionLink || "Baseline"}`;

        const noteLabel = document.createElement("label");
        noteLabel.className = "sr-only";
        noteLabel.setAttribute("for", `noteInput_${idx}`);
        noteLabel.textContent = `Note for ${ch.title}`;

        const noteInput = document.createElement("input");
        noteInput.type = "text";
        noteInput.id = `noteInput_${idx}`;
        noteInput.value = ch.note || "";
        noteInput.placeholder = "Observation on this version...";
        noteInput.addEventListener("input", (e) => {
          choices[idx].note = e.target.value;
          persistSessionState();
        });

        const keepBtn = document.createElement("button");
        keepBtn.type = "button";
        keepBtn.className = `btn ${isKept ? "btn-primary" : ""}`;
        keepBtn.setAttribute("aria-pressed", String(isKept));
        keepBtn.textContent = isKept ? "Kept Version" : "Select to Keep";
        keepBtn.addEventListener("click", () => {
          if (isP3 && keptChoiceIdx !== idx) decisionRecorded = false;
          keptChoiceIdx = idx;
          showDecision();
          renderCompareGallery();
          persistSessionState();
        });

        article.appendChild(head);
        article.appendChild(miniBoard);
        article.appendChild(reflectMeta);
        const noteDetails = document.createElement("details");
        const noteSummary = document.createElement("summary");
        noteSummary.textContent = "Version note";
        noteDetails.append(noteSummary, noteLabel, noteInput);
        article.append(noteDetails, keepBtn);
        grid.appendChild(article);
      });

      const kept = choices[keptChoiceIdx];
      if (kept) {
        document.getElementById("selectedSummaryBadge").textContent =
          `Kept: ${kept.title} (${kept.source})`;
      }
    }

    function renderJourneyReferences() {
      const baseline = choices[0];
      const kept = choices[keptChoiceIdx];
      if (!baseline || !kept) return;
      document.getElementById("journeyBaseline").replaceChildren(compositionReference("Your V1", baseline.squares));
      document.getElementById("journeyFinal").replaceChildren(compositionReference("Final choice · " + kept.title, kept.squares));
      document.getElementById("finalReasonLabel").textContent =
        `What makes this version feel right for ${selectedConcept.toLowerCase()} now?`;
    }

    function buildSessionPayload() {
      const kept = choices[keptChoiceIdx];
      return {
        timestamp: new Date().toISOString(),
        participationMode: mode,
        currentStep,
        explorations,
        reviewedArrangement,
        explorationDraft: mode === "online" && !v1Locked ? workingSquares : null,
        markedSample,
        ...(isP3 && { savedSamples, variationSkipped, exportUnlocked, decisionRecorded, activeChoiceIdx, workingDraft: workingSquares }),
        compareRequested,
        concept: selectedConcept,
        firstReflection,
        secondReflection,
        ...(!isP3 && {
          galleryPostId,
          inspirationIds: [...inspiration],
          inspiringWorks: galleryPosts().filter(post => inspiration.has(post.id))
        }),
        keptChoiceIdx,
        reflectionDraft: (isP3 && secondReflection && !revisingDecision ? secondReflection.text : document.getElementById("understandingShiftField").value).trim(),
        initialGoal: document.getElementById("goalField").value.trim(),
        plannedNextBeforeFeedback: document.getElementById("nextField").value.trim(),
        understandingShiftExplanation: (isP3 && secondReflection ? secondReflection.text : document.getElementById("understandingShiftField").value).trim(),
        finalKeptVersion: kept ? kept.title : "None",
        finalDecisionRationale: document.getElementById("finalReasonField").value.trim(),
        versionsHistory: choices
      };
    }

    function persistSessionState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSessionPayload()));
        if (isP3) setLocalSaveStatus("saved", "Saved locally · " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
        return true;
      } catch {
        if (isP3) setLocalSaveStatus("error", "Local save failed");
        return false;
      }
    }

    function saveReflectionDraft() {
      document.getElementById("draftStatus").textContent = persistSessionState()
        ? "Draft saved in this browser."
        : "Browser storage unavailable or full. Export a session copy from the final step.";
    }

    function readDraft() {
      try {
        const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (!draft?.versionsHistory?.length || (isP3 && draft.participationMode !== "online")) return null;
        return draft.firstReflection || draft.explorations?.length || (isP3 && draft.explorationDraft?.length) ? draft : null;
      } catch {
        return null;
      }
    }

    function refreshResumeButton() {
      document.getElementById("resumeDraftBtn").hidden = !readDraft();
    }

    function resumeDraft() {
      const draft = readDraft();
      if (!draft) return;
      selectedConcept = draft.concept;
      document.getElementById("conceptPicker").hidden = true;
      launchApp(draft.participationMode);
      choices = draft.versionsHistory;
      explorations = draft.explorations || [];
      reviewedArrangement = draft.reviewedArrangement ?? null;
      firstReflection = draft.firstReflection;
      if (!firstReflection) {
        workingSquares = clone(draft.explorationDraft || explorations[reviewedArrangement] || explorations.at(-1));
        document.getElementById("goalField").value = draft.initialGoal || "";
        if (isP3) document.getElementById("nextField").value = draft.plannedNextBeforeFeedback || "";
        goToStep(isP3 && draft.currentStep === 1.25 && reviewedArrangement !== null ? 1.25 : explorations.length === EXPLORATION_COUNT ? 1.1 : 1);
        return;
      }
      secondReflection = draft.secondReflection;
      markedSample = draft.markedSample ?? null;
      savedSamples = (draft.savedSamples || (markedSample === null ? [] : [markedSample]))
        .filter(index => Number.isInteger(index) && galleryExamples[selectedConcept]?.[index]).slice(0, 2);
      variationSkipped = draft.variationSkipped ?? Boolean(draft.secondReflection && draft.currentStep === 4 && choices.length === 1);
      if (isP3 && draft.currentStep === 3 && draft.workingDraft?.length) {
        workingSquares = clone(draft.workingDraft);
        activeChoiceIdx = draft.activeChoiceIdx ?? 0;
      }
      compareRequested = Boolean(draft.compareRequested);
      exportUnlocked = draft.exportUnlocked ?? Boolean(secondReflection && (draft.currentStep === 4 || variationSkipped || compareRequested));
      decisionRecorded = Boolean(draft.decisionRecorded);
      galleryPostId = draft.galleryPostId;
      (draft.inspirationIds || []).forEach(id => inspiration.add(id));
      if (!isP3 || draft.currentStep !== 3 || !draft.workingDraft?.length) workingSquares = clone(choices[0].squares);
      workingPhoto = choices[0].photo || "";
      keptChoiceIdx = draft.keptChoiceIdx ?? 0;
      v1Locked = true;
      const fields = {
        goalField: firstReflection.text, nextField: firstReflection.next,
        understandingShiftField: draft.reflectionDraft,
        finalReasonField: draft.finalDecisionRationale
      };
      Object.entries(fields).forEach(([id, value]) => {
        document.getElementById(id).value = value || "";
      });
      ["goalField", "nextField"].forEach(id => { document.getElementById(id).readOnly = true; });
      document.getElementById("v1LockBadge").textContent = "Locked";
      document.getElementById("lockV1Btn").textContent = "Open Gallery";
      validateStep2Gate();
      const resumeStep = secondReflection && draft.currentStep === 3 ? 3
        : secondReflection && secondReflection.text === draft.reflectionDraft ? 4
        : draft.reflectionDraft || (isP3 && draft.currentStep === 2) ? 2 : 1.5;
      const savedStep = draft.currentStep;
      if (isP3 && savedStep === 1.1) goToStep(1.1);
      else if (isP3 && canVisitP3Step(savedStep)) goToStep(savedStep);
      else goToStep(resumeStep);
    }

    function resetSessionStorage() {
      if (isP3) {
        document.getElementById("resetDialog").close();
        setLocalSaveStatus("idle", "Local autosave");
      }
      document.querySelector(".session-actions").open = false;
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      startBlankSession();
    }

    function hideDecisionExport() {
      document.getElementById("decisionExport").hidden = true;
    }

    function showDecision() {
      document.getElementById("continueDecisionBtn").hidden = true;
      document.getElementById("selectedSummaryBadge").hidden = false;
      document.getElementById("decisionPanel").hidden = false;
      hideDecisionExport();
      if (isP3) renderJourneyReferences();
      document.getElementById("finalReasonLabel").focus();
    }

    function recordDecisionLog(record = true) {
      if (isP3 && record) decisionRecorded = true;
      const saved = record ? persistSessionState() : true;
      const payload = buildSessionPayload();
      const output = document.getElementById("finalLogOutput");
      output.replaceChildren();
      document.getElementById("decisionExport").hidden = false;

      const heading = document.createElement("strong");
      heading.textContent = saved ? "Decision saved in this browser." : "Decision ready to export. Browser storage is unavailable or full.";
      output.appendChild(heading);

      const metaLine = document.createElement("div");
      metaLine.textContent = `Kept: ${payload.finalKeptVersion}`;
      output.appendChild(metaLine);

      const shiftLine = document.createElement("div");
      shiftLine.textContent = `Understanding Shift: ${payload.understandingShiftExplanation}`;
      output.appendChild(shiftLine);

      payload.versionsHistory.forEach((c, idx) => {
        const row = document.createElement("div");
        row.className = "log-item";
        row.textContent = `${c.title} [${idx === keptChoiceIdx ? "KEPT" : "EXPLORED"}] (${c.source}) — ${c.note || "No note"}`;
        output.appendChild(row);
      });

      const reasonLine = document.createElement("div");
      reasonLine.textContent = `Final Rationale: ${payload.finalDecisionRationale || "None recorded"}`;
      output.appendChild(reasonLine);
      if (record) output.focus();
    }

    function exportSessionJSON() {
      const payload = buildSessionPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      triggerFileDownload(blob, `4squares-session-${mode}.json`);
    }

    function downloadSessionSummaryTxt() {
      const p = buildSessionPayload();
      const lines = [
        "4SQUARES WORKSPACE — SESSION SUMMARY",
        `Timestamp: ${p.timestamp}`,
        `Mode: ${p.participationMode}`,
        `Concept: ${p.concept}`,
        `Reflection 1: ${p.firstReflection?.text || ""}`,
        `Reflection 2: ${p.secondReflection?.text || ""}`,
        "",
        "1. INITIAL FRAMING (V1 BASELINE)",
        `Intended Meaning: ${p.initialGoal}`,
        `Planned Next Step: ${p.plannedNextBeforeFeedback}`,
        "",
        "2. GALLERY & REFLECTION",
        `Understanding Shift: ${p.understandingShiftExplanation}`,
        "",
        "3. SAVED VERSIONS TRAJECTORY",
        ...p.versionsHistory.map((v, i) =>
          `- ${v.title} [${i === keptChoiceIdx ? "KEPT" : "EXPLORED"}] (Source: ${v.source})\n  Note: ${v.note}\n  Squares: ${JSON.stringify(v.squares)}`
        ),
        "",
        "4. FINAL DECISION",
        `Kept Version: ${p.finalKeptVersion}`,
        `Decision Rationale: ${p.finalDecisionRationale}`
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
      triggerFileDownload(blob, `4squares-summary-${mode}.txt`);
    }

    function triggerFileDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
    orderWalkthroughControls();
    refreshResumeButton();

  
    const clickActions = {
      "choose-concept": event => chooseConcept(event.currentTarget),
      "resume-draft": () => resumeDraft(),
      "show-tutorial-step": () => showTutorialStep(tutorialStep - 1),
      "advance-tutorial": () => advanceTutorial(),
      "close-tutorial": () => closeTutorial(),
      "open-tutorial": () => openTutorial(),
      "navigate-p3-step": event => navigateP3Step(Number(event.currentTarget.dataset.step)),
      "revise-reflection-decision": () => reviseReflectionDecision(),
      "navigate-mobile-step": () => navigateMobileStep(1),
      "navigate-mobile-step-2": () => navigateMobileStep(2),
      "navigate-mobile-step-3": () => navigateMobileStep(3),
      "navigate-mobile-step-4": () => navigateMobileStep(4),
      "navigate-mobile-step-5": () => navigateMobileStep(1.5),
      "open-reset-dialog": () => document.getElementById("resetDialog").showModal(),
      "navigate-pre-reflection": () => goToStep(1.25),
      "reset-session-storage": () => resetSessionStorage(),
      "go-to-step": () => goToStep(2),
      "scroll-samples": () => scrollSamples(-1),
      "scroll-samples-2": () => scrollSamples(1),
      "publish-to-gallery": () => publishToGallery(),
      "export-gallery": () => exportGallery(),
      "select-choice": () => selectChoice(0),
      "on-board-background-tap": event => onBoardBackgroundTap(event),
      "rotate-active-square": event => rotateActiveSquare(-15, event),
      "rotate-active-square-2": event => rotateActiveSquare(15, event),
      "reset-active-tilt": event => resetActiveTilt(event),
      "use-digital-canvas": () => useDigitalCanvas(),
      "document-get-element-by-id": () => document.getElementById('compositionCamera').click(),
      "document-get-element-by-id-2": () => document.getElementById('compositionUpload').click(),
      "store-new-choice": () => storeNewChoice(),
      "discard-working-draft": () => discardWorkingDraft(),
      "confirm-discard-draft": () => confirmDiscardWorkingDraft(),
      "undo-canvas": () => restoreCanvasEdit(false),
      "redo-canvas": () => restoreCanvasEdit(true),
      "go-to-step-2": () => goToStep(3),
      "save-exploration": () => saveExploration(),
      "lock-baseline-v1": () => lockBaselineV1(),
      "go-to-step-3": () => goToStep(1.25),
      "go-to-step-4": () => goToStep(mode === 'online' ? 1.1 : 1),
      "go-to-step-5": () => goToStep(1.5),
      "show-reflection-next": () => showReflectionNext(),
      "finish-reflection": () => finishReflection(false),
      "finish-reflection-2": () => finishReflection(true),
      "save-reflection-draft": () => saveReflectionDraft(),
      "proceed-to-comparison": () => proceedToComparison(),
      "show-decision": () => showDecision(),
      "record-decision-log": () => recordDecisionLog(),
      "export-session-json": () => exportSessionJSON(),
      "download-session-summary-txt": () => downloadSessionSummaryTxt(),
      "show-concept-picker": () => showConceptPicker(),
      "launch-app": () => launchApp('online'),
      "launch-app-2": () => launchApp('inperson'),
      "go-to-step-6": () => goToStep(1),
    };

    const toggleActions = {
      "show-gallery-v1": () => showGalleryV1(),
    };

    const changeActions = {
      "import-gallery": event => importGallery(event.currentTarget),
      "render-board": () => renderBoard(),
      "load-composition-photo": event => loadCompositionPhoto(event.currentTarget),
      "render-compare-gallery": () => renderCompareGallery(),
    };

    const pointerdownActions = {
      "event-stop-propagation": event => event.stopPropagation(),
    };

    const inputActions = {
      "validate-step1-gate": () => { validateStep1Gate(); if (isP3) persistSessionState(); },
      "validate-step2-gate": () => { validateStep2Gate(); if (isP3) persistSessionState(); },
      "hide-decision-export": () => {
        hideDecisionExport();
        if (isP3) { decisionRecorded = false; persistSessionState(); }
      },
    };

    for (const [event, actions] of Object.entries({
      click: clickActions, change: changeActions, input: inputActions,
      toggle: toggleActions, pointerdown: pointerdownActions
    })) {
      document.querySelectorAll(`[data-${event}]`).forEach(element => {
        element.addEventListener(event, actions[element.getAttribute(`data-${event}`)]);
      });
    }

    if (isP3) {
      const entry = document.getElementById("entryGate");
      const bubbles = [...document.querySelectorAll("#conceptPicker .concept-bubble")];
      const washes = [...entry.querySelectorAll(".entry-wash")];
      const motion = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
      let frame = 0;

      function resetEntryMotion() {
        cancelAnimationFrame(frame);
        for (const bubble of bubbles) {
          bubble.style.removeProperty("--pull-x");
          bubble.style.removeProperty("--pull-y");
        }
        for (const wash of washes) {
          wash.style.removeProperty("--wash-x");
          wash.style.removeProperty("--wash-y");
        }
      }

      entry.addEventListener("pointermove", event => {
        if (!motion.matches || event.pointerType !== "mouse") return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const bounds = entry.getBoundingClientRect();
          const x = (event.clientX - bounds.left) / bounds.width - .5;
          const y = (event.clientY - bounds.top) / bounds.height - .5;
          washes.forEach((wash, index) => {
            const strength = index === 0 ? 26 : -20;
            wash.style.setProperty("--wash-x", x * strength + "px");
            wash.style.setProperty("--wash-y", y * strength + "px");
          });
          bubbles.forEach(bubble => {
            if (!bubble.offsetParent) return;
            const center = bubble.offsetLeft + bubble.offsetWidth / 2;
            const middle = bubble.offsetTop + bubble.offsetHeight / 2;
            const parent = bubble.offsetParent.getBoundingClientRect();
            const dx = event.clientX - parent.left - center;
            const dy = event.clientY - parent.top - middle;
            const distance = Math.hypot(dx, dy);
            const pull = distance < 125 ? .055 : 0;
            bubble.style.setProperty("--pull-x", dx * pull + "px");
            bubble.style.setProperty("--pull-y", dy * pull + "px");
          });
        });
      });
      entry.addEventListener("pointerleave", resetEntryMotion);
      motion.addEventListener("change", resetEntryMotion);
    }

    if (isP3) {
      const entry = document.getElementById("entryGate");
      const picker = document.getElementById("conceptPicker");
      const bubbles = [...picker.querySelectorAll(".concept-bubble")];
      const touchLayout = window.matchMedia("(hover: none) and (pointer: coarse), (max-width: 767px)");
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let spotlight = null;
      let spotlightIndex = 0;
      let spotlightTimer = 0;
      let interacted = false;
      let press = null;
      let releasedBubble = null;
      let confirming = false;

      function stopSpotlight() {
        clearInterval(spotlightTimer);
        spotlightTimer = 0;
        spotlight?.classList.remove("is-spotlit");
        spotlight = null;
      }

      function syncSpotlight() {
        const canRun = touchLayout.matches && !reducedMotion.matches &&
          !interacted && !document.hidden && !entry.hidden && !picker.hidden;
        if (!canRun) stopSpotlight();
        else if (!spotlightTimer) {
          spotlightTimer = setInterval(() => {
            spotlight?.classList.remove("is-spotlit");
            spotlight = bubbles[spotlightIndex];
            spotlight.classList.add("is-spotlit");
            spotlightIndex = (spotlightIndex + 1) % bubbles.length;
          }, 2800);
        }
      }

      entry.addEventListener("pointerdown", event => {
        if (picker.hidden || !touchLayout.matches) return;
        interacted = true;
        releasedBubble = null;
        stopSpotlight();
        const bubble = event.target.closest("#conceptPicker .concept-bubble");
        if (!event.isPrimary || event.pointerType === "mouse" || !bubble || confirming) return;
        press = { bubble, pointerId: event.pointerId };
        bubble.classList.add("is-touch-pressed");
      });

      function releaseBubble(event) {
        if (press?.pointerId !== event.pointerId) return;
        press.bubble.classList.remove("is-touch-pressed");
        releasedBubble = event.type === "pointerup" ? press.bubble : null;
        press = null;
      }

      window.addEventListener("pointerup", releaseBubble);
      window.addEventListener("pointercancel", releaseBubble);
      picker.addEventListener("click", event => {
        const bubble = event.target.closest(".concept-bubble");
        if (!bubble) return;
        interacted = true;
        stopSpotlight();
        if (confirming) {
          event.stopPropagation();
          return;
        }
        const touchClick = ["touch", "pen"].includes(event.pointerType) ||
          (!event.pointerType && event.detail > 0 && releasedBubble === bubble);
        releasedBubble = null;
        if (!touchLayout.matches || !touchClick || reducedMotion.matches) return;
        event.stopPropagation();
        confirming = true;
        bubble.classList.add("is-touch-confirmed");
        setTimeout(() => {
          confirming = false;
          bubble.classList.remove("is-touch-confirmed");
          if (!entry.hidden && !picker.hidden) chooseConcept(bubble);
        }, 160);
      }, true);

      const entryVisibility = new MutationObserver(syncSpotlight);
      for (const element of [entry, picker]) {
        entryVisibility.observe(element, { attributes: true, attributeFilter: ["hidden"] });
      }
      document.addEventListener("visibilitychange", syncSpotlight);
      touchLayout.addEventListener("change", syncSpotlight);
      reducedMotion.addEventListener("change", syncSpotlight);
      syncSpotlight();
    }
