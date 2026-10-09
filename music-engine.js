/*
 * =====================================================================
 * MUSIC ENGINE
 *
 * Shared logic used by every activity (the player, the puzzle, and
 * whatever comes next). This is the ONLY place that should talk
 * directly to Verovio and MIDIjs - activities call these functions
 * instead of duplicating the setup.
 * =====================================================================
 */

window.MusicEngine = (function () {


    /*
     * =================================================
     * STARTUP
     * =================================================
     */

    /*
     * Call this once, from each page, instead of writing
     * "verovio.module.onRuntimeInitialized = ..." yourself.
     *
     * callback(toolkit) runs as soon as Verovio is ready.
     * The same toolkit is also stored on window.toolkit,
     * in case older code expects to find it there.
     */
    function ready(callback) {

        verovio.module.onRuntimeInitialized = function () {

            window.toolkit = new verovio.toolkit();

            if (callback) {
                callback(window.toolkit);
            }

        };

    }


    /*
     * =================================================
     * LOADING
     * =================================================
     */

    /*
     * Fetches a MusicXML file and returns its text.
     * Does NOT load it into a toolkit - that's a separate
     * step, so you can decide what to do with the raw XML
     * first (e.g. keep a copy for the puzzle to slice up).
     */
    function loadMusicXML(path) {

        return fetch(path)
            .then(function (response) {
                return response.text();
            });

    }


    /*
     * Fetches the melody catalog (a JSON file listing every
     * piece the app knows about) and returns it as an array.
     * Each entry looks like:
     *   { "id": "...", "title": "...", "composer": "...", "file": "..." }
     */
    function loadCatalog(path) {

        return fetch(path)
            .then(function (response) {
                return response.json();
            });

    }


    /*
     * How many measures a MusicXML piece has. Used so the puzzle
     * (and anything else) doesn't have to hardcode a measure count -
     * different melodies will have different lengths.
     */
    function countMeasures(musicXML) {

        const parser = new DOMParser();

        const doc = parser.parseFromString(musicXML, "application/xml");

        const part = doc.querySelector("part");

        if (!part) {
            return 0;
        }

        return part.querySelectorAll(":scope > measure").length;

    }


    /*
     * Returns an array with one "sound signature" string per
     * measure, built purely from each measure's actual pitches
     * and rhythms (notes and rests) - ignoring things like
     * formatting, lyrics, or directions that don't affect how it
     * sounds or looks musically. Two measures with the identical
     * notes and rhythm get the identical signature, regardless of
     * where in the piece they sit. Used for activities (like
     * "find it in the score") where a piece's repeated measures
     * should all count as valid answers, not just the one that
     * happened to be played.
     */
    function getMeasureSignatures(musicXML) {

        const parser = new DOMParser();

        const doc = parser.parseFromString(musicXML, "application/xml");

        const part = doc.querySelector("part");

        if (!part) {
            return [];
        }

        const measures =
            Array.from(part.querySelectorAll(":scope > measure"));

        return measures.map(function (measure) {

            const notes =
                Array.from(measure.querySelectorAll(":scope > note"));

            const noteSignatures = notes.map(function (note) {

                const duration = note.querySelector("duration");
                const type = note.querySelector("type");

                const durationPart =
                    (type ? type.textContent : "?") + ":" +
                    (duration ? duration.textContent : "?");

                const isRest = note.querySelector("rest") !== null;

                if (isRest) {
                    return "rest:" + durationPart;
                }

                const pitch = note.querySelector("pitch");

                if (!pitch) {
                    return "?:" + durationPart;
                }

                const step = pitch.querySelector("step");
                const alter = pitch.querySelector("alter");
                const octave = pitch.querySelector("octave");

                const isChordNote =
                    note.querySelector(":scope > chord") !== null;

                return (isChordNote ? "+" : "") +
                    (step ? step.textContent : "?") +
                    (alter ? alter.textContent : "0") +
                    (octave ? octave.textContent : "?") + ":" +
                    durationPart;

            });

            return noteSignatures.join(",");

        });

    }


    /*
     * =================================================
     * RENDERING THE FULL SCORE
     * =================================================
     */

    /*
     * Loads musicXML into the given toolkit and renders
     * page 1 into the element with id = targetElementId.
     * Returns the SVG string too, in case the caller wants it.
     */
    function renderScore(toolkit, musicXML, targetElementId) {

        toolkit.loadData(musicXML);

        const svg = toolkit.renderToSVG(1, {});

        const target = document.getElementById(targetElementId);

        if (target) {
            target.innerHTML = svg;
        }

        return svg;

    }


    /*
     * =================================================
     * PLAYBACK
     * =================================================
     */

    /*
     * Plays whatever is currently loaded in the given toolkit.
     */
    function playMIDI(toolkit) {

        const base64midi = toolkit.renderToMIDI();

        MIDIjs.play("data:audio/midi;base64," + base64midi);

    }


    /*
     * Loads a MusicXML string into a throwaway toolkit and
     * plays it directly. Useful when you have a piece of XML
     * (e.g. a reordered puzzle) that isn't loaded into any
     * toolkit yet, and you don't want to disturb the main one.
     */
    function playMusicXML(musicXML) {

        const tempToolkit = new verovio.toolkit();

        tempToolkit.loadData(musicXML);

        playMIDI(tempToolkit);

    }


    /*
     * Stops playback and clears any highlighted notes.
     */
    function stopMIDI() {

        MIDIjs.stop();

        document
            .querySelectorAll("g.note.playing")
            .forEach(function (note) {
                note.classList.remove("playing");
            });

    }


    /*
     * =================================================
     * NOTE HIGHLIGHTING DURING PLAYBACK
     * =================================================
     */

    /*
     * Wires up MIDIjs so that, as the given toolkit's score
     * plays, the notes sounding right now get the "playing"
     * CSS class (and the previous ones lose it).
     */
    function attachHighlighting(toolkit) {

        MIDIjs.player_callback = function (event) {

            document
                .querySelectorAll("g.note.playing")
                .forEach(function (note) {
                    note.classList.remove("playing");
                });

            /*
             * MIDIjs sends a final callback with status "finished"
             * once playback ends. Without checking for it, the
             * code below would look up "whatever is sounding at
             * the final timestamp" - which is still the last note
             * - and re-highlight it with nothing ever coming along
             * afterward to clear it again. Stop here instead.
             */
            if (event.status === "finished") {
                return;
            }

            /*
             * MIDIjs time = seconds, Verovio time = milliseconds.
             */
            const elements =
                toolkit.getElementsAtTime(event.time * 1000);

            if (elements.notes) {

                elements.notes.forEach(function (noteID) {

                    const noteElement =
                        document.getElementById(noteID);

                    if (noteElement) {
                        noteElement.classList.add("playing");
                    }

                });

            }

        };

    }


    /*
     * =================================================
     * MAKE A MINI MUSICXML DOCUMENT (ONE MEASURE)
     * =================================================
     */

    function makeMiniMusicXML(originalXML, measureNumber) {

        const parser = new DOMParser();

        const xmlDoc =
            parser.parseFromString(originalXML, "application/xml");

        const scorePartwise = xmlDoc.documentElement;

        const originalPart = scorePartwise.querySelector("part");

        if (!originalPart) {
            throw new Error("Could not find a part in the MusicXML.");
        }

        const measures =
            Array.from(originalPart.querySelectorAll(":scope > measure"));

        if (measureNumber < 1 || measureNumber > measures.length) {
            throw new Error("Requested measure does not exist.");
        }

        const newDoc =
            document.implementation.createDocument(
                null, "score-partwise", null
            );

        const newRoot = newDoc.documentElement;

        newRoot.setAttribute(
            "version",
            scorePartwise.getAttribute("version") || "4.0"
        );

        const newPart = newDoc.createElement("part");

        newPart.setAttribute(
            "id",
            originalPart.getAttribute("id") || "P1"
        );

        /*
         * Note: we deliberately do NOT copy <work> or
         * <identification> into the mini document. Those hold
         * the piece's title and composer, and Verovio renders
         * them as a page header - which, for a puzzle piece
         * cropped down to one measure, just shows up as stray
         * text (e.g. "Untitled score") overlapping the notation.
         * A single isolated measure doesn't need a title anyway.
         *
         * <part-list> is different: it's structurally required
         * (it's what maps our <part> to a score-part), so it
         * still needs to be copied over.
         */
        const partList = scorePartwise.querySelector("part-list");

        if (partList) {
            newRoot.appendChild(newDoc.importNode(partList, true));
        }

        /*
         * We need the first measure's attributes: clef, key,
         * time, divisions, etc.
         */
        const firstMeasure = measures[0];

        const attributes = firstMeasure.querySelector("attributes");

        const selectedMeasure =
            newDoc.importNode(measures[measureNumber - 1], true);

        /*
         * Always renumber this as measure 1, regardless of which
         * measure it actually was. Otherwise Verovio displays the
         * real original measure number (e.g. "3") above the piece,
         * which hands the puzzle's answer to the player for free.
         */
        selectedMeasure.setAttribute("number", "1");

        /*
         * If this isn't the first measure, add the initial
         * <attributes> information to it - a MusicXML part
         * always needs clef/key/time up front.
         */
        if (measureNumber > 1 && attributes) {

            const alreadyHasAttributes =
                selectedMeasure.querySelector("attributes");

            if (!alreadyHasAttributes) {

                selectedMeasure.insertBefore(
                    newDoc.importNode(attributes, true),
                    selectedMeasure.firstChild
                );

            }

        }

        newPart.appendChild(selectedMeasure);

        newRoot.appendChild(newPart);

        return new XMLSerializer().serializeToString(newDoc);

    }


    /*
     * =================================================
     * MAKE AN EXCERPT (A RANGE OF MEASURES) MUSICXML DOCUMENT
     * =================================================
     */

    /*
     * Like makeMiniMusicXML, but extracts a contiguous RANGE of
     * measures (e.g. measures 5-6) instead of just one. Used for
     * "find it in the score"-style activities, where a short
     * excerpt is played but the player has to locate it in the
     * full, unmodified notation - so unlike makeMiniMusicXML,
     * this does NOT renumber the excerpt as starting from
     * measure 1 (there's no answer to hide here).
     */
    function makeExcerptMusicXML(originalXML, startMeasure, measureCount) {

        const parser = new DOMParser();

        const xmlDoc =
            parser.parseFromString(originalXML, "application/xml");

        const scorePartwise = xmlDoc.documentElement;

        const originalPart = scorePartwise.querySelector("part");

        if (!originalPart) {
            throw new Error("Could not find a part in the MusicXML.");
        }

        const measures =
            Array.from(originalPart.querySelectorAll(":scope > measure"));

        const endMeasure = startMeasure + measureCount - 1;

        if (startMeasure < 1 || endMeasure > measures.length) {
            throw new Error("Requested excerpt is out of range.");
        }

        const newDoc =
            document.implementation.createDocument(
                null, "score-partwise", null
            );

        const newRoot = newDoc.documentElement;

        newRoot.setAttribute(
            "version",
            scorePartwise.getAttribute("version") || "4.0"
        );

        /*
         * Deliberately no <work> or <identification> here either -
         * same reasoning as makeMiniMusicXML: Verovio would render
         * them as a page header, which clutters a short excerpt.
         */
        const partList = scorePartwise.querySelector("part-list");

        if (partList) {
            newRoot.appendChild(newDoc.importNode(partList, true));
        }

        const newPart = newDoc.createElement("part");

        newPart.setAttribute(
            "id",
            originalPart.getAttribute("id") || "P1"
        );

        const firstMeasureAttributes =
            measures[0].querySelector(":scope > attributes");

        for (let i = startMeasure; i <= endMeasure; i++) {

            const imported = newDoc.importNode(measures[i - 1], true);

            imported.setAttribute(
                "number", String(i - startMeasure + 1)
            );

            /*
             * If the excerpt doesn't start at the piece's actual
             * first measure, carry over the initial clef/key/time
             * so the excerpt is still playable on its own.
             */
            if (i === startMeasure &&
                startMeasure > 1 &&
                firstMeasureAttributes) {

                const alreadyHasAttributes =
                    imported.querySelector(":scope > attributes");

                if (!alreadyHasAttributes) {

                    imported.insertBefore(
                        newDoc.importNode(firstMeasureAttributes, true),
                        imported.firstChild
                    );

                }

            }

            newPart.appendChild(imported);

        }

        newRoot.appendChild(newPart);

        return new XMLSerializer().serializeToString(newDoc);

    }


    /*
     * =================================================
     * MAKE A REORDERED MUSICXML DOCUMENT
     * =================================================
     */

    function makeReorderedMusicXML(originalXML, order) {

        const parser = new DOMParser();

        const doc =
            parser.parseFromString(originalXML, "application/xml");

        const part = doc.querySelector("part");

        const measures =
            Array.from(part.querySelectorAll(":scope > measure"));

        const newDoc =
            document.implementation.createDocument(
                null, "score-partwise", null
            );

        const root = newDoc.documentElement;

        root.setAttribute(
            "version",
            doc.documentElement.getAttribute("version") || "3.1"
        );

        const work = doc.querySelector("work");

        if (work) {
            root.appendChild(newDoc.importNode(work, true));
        }

        const identification = doc.querySelector("identification");

        if (identification) {
            root.appendChild(newDoc.importNode(identification, true));
        }

        const partList = doc.querySelector("part-list");

        if (partList) {
            root.appendChild(newDoc.importNode(partList, true));
        }

        const newPart = newDoc.createElement("part");

        newPart.setAttribute("id", part.getAttribute("id"));

        order.forEach(function (measureNumber, index) {

            const originalMeasure = measures[measureNumber - 1];

            if (!originalMeasure) {
                return;
            }

            const newMeasure =
                newDoc.importNode(originalMeasure, true);

            /*
             * The first measure of a MusicXML part must contain
             * the musical attributes (clef, key, time signature).
             * If the puzzle starts with measure 2, 3, or 4, copy
             * those attributes from the original first measure.
             */
            if (index === 0) {

                const attributes =
                    measures[0].querySelector(":scope > attributes");

                const alreadyHasAttributes =
                    newMeasure.querySelector(":scope > attributes");

                if (attributes && !alreadyHasAttributes) {

                    newMeasure.insertBefore(
                        newDoc.importNode(attributes, true),
                        newMeasure.firstChild
                    );

                }

            }

            newMeasure.setAttribute("number", String(index + 1));

            newPart.appendChild(newMeasure);

        });

        root.appendChild(newPart);

        return new XMLSerializer().serializeToString(newDoc);

    }


    /*
     * =================================================
     * RENDER ONE MINI SCORE (a single legible measure,
     * cropped tightly and scaled to fill its box)
     * =================================================
     */

    /*
     * Renders a single music snippet, but stops short of scaling
     * it to a final size - that happens later, once we know the
     * dimensions of every snippet in the set (see
     * renderMiniMeasureSet below). Returns null if something
     * goes wrong (e.g. malformed XML).
     *
     * anchorSelector picks what gets kept and cropped around:
     *   - "g.measure" (the default) for a single isolated
     *     measure, like a puzzle piece.
     *   - "g.system" for a short multi-measure phrase (a whole
     *     line of music) - e.g. a notation variant in the
     *     "listen and choose" activity, which usually needs to
     *     show more than one measure.
     */
    function prepareMiniMeasure(miniXML, anchorSelector) {

        const selector = anchorSelector || "g.measure";

        const miniToolkit = new verovio.toolkit();

        /*
         * These are layout options (they affect justification,
         * line breaks, page size), so they MUST be set before
         * loadData() - loadData() is what actually runs the
         * layout. Setting them afterwards, e.g. as an argument
         * to renderToSVG(), is too late: the layout has already
         * happened and options like adjustPageWidth/breaks are
         * silently ignored.
         */
        miniToolkit.setOptions({
            scale: 100,
            pageWidth: 1000,
            pageHeight: 500,
            adjustPageWidth: true,
            adjustPageHeight: true,
            breaks: "none"
        });

        miniToolkit.loadData(miniXML);

        /*
         * Render the snippet. No layout options here anymore -
         * the layout was already done above, using the options
         * that were actually applied.
         */
        const svgString = miniToolkit.renderToSVG(1, {});

        /*
         * Put the SVG temporarily into the document so that the
         * browser can inspect its geometry.
         */
        const temp = document.createElement("div");

        temp.style.position = "absolute";
        temp.style.visibility = "hidden";

        temp.innerHTML = svgString;

        document.body.appendChild(temp);

        const svg = temp.querySelector("svg");

        const measure = svg.querySelector(selector);

        if (!measure) {

            console.error(
                "Could not find \"" + selector + "\" in the SVG."
            );

            document.body.removeChild(temp);

            return null;
        }

        /*
         * Strip away everything that ISN'T on the direct path
         * from the svg root down to the measure. That covers,
         * wherever in the hierarchy they actually sit: the page
         * title/composer credit ("Untitled score"), instrument
         * labels ("Piano"), the brace/bracket connecting staves,
         * and anything else Verovio draws around a full page
         * that a single isolated measure doesn't need. Since we
         * only move the measure itself when cropping, any of
         * these left in place would stay behind at their old
         * position and end up floating on top of the music.
         *
         * IMPORTANT EXCEPTION: <defs> (and <style>, if present)
         * must always be kept, no matter where they sit. Verovio
         * defines every notehead/clef/rest glyph once inside
         * <defs> and reuses them everywhere via <use> references.
         * They're usually a sibling of the page content at the
         * SVG root - exactly the kind of "sibling" this cleanup
         * would otherwise delete. Removing them doesn't just
         * leave stray elements behind, it breaks EVERY symbol in
         * the piece, since all those <use> references now point
         * to nothing.
         */
        let node = measure;

        while (node.parentElement && node !== svg) {

            const parent = node.parentElement;

            Array.from(parent.children).forEach(function (sibling) {

                if (sibling === node) {
                    return;
                }

                const tagName =
                    sibling.tagName
                        ? sibling.tagName.toLowerCase()
                        : "";

                if (tagName === "defs" || tagName === "style") {
                    return;
                }

                parent.removeChild(sibling);

            });

            node = parent;

        }

        const box = measure.getBBox();

        document.body.removeChild(temp);

        return {
            svg: svg,
            measure: measure,
            box: box,
            toolkit: miniToolkit
        };

    }


    /*
     * Takes a prepared measure (from prepareMiniMeasure) and a
     * shared canvas size, and produces the final, sized SVG
     * string. The measure is centered within that canvas. Using
     * the SAME canvas size for every piece in a puzzle is what
     * keeps notation a consistent, legible size across pieces -
     * a sparse one-line melody and a dense two-staff piano piece
     * end up with the same notehead size, just with more or less
     * surrounding space.
     */
    function finalizeMiniMeasure(prepared, canvasWidth, canvasHeight) {

        const svg = prepared.svg;
        const measure = prepared.measure;
        const box = prepared.box;

        const offsetX = (canvasWidth - box.width) / 2 - box.x;
        const offsetY = (canvasHeight - box.height) / 2 - box.y;

        measure.setAttribute(
            "transform",
            "translate(" + offsetX + " " + offsetY + ")"
        );

        svg.setAttribute(
            "viewBox",
            "0 0 " + canvasWidth + " " + canvasHeight
        );

        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.setAttribute("width", "360");
        svg.setAttribute("height", "220");

        return svg.outerHTML;

    }


    /*
     * Renders every mini measure needed for one puzzle, all at
     * the SAME scale. Pass an array of miniXML strings (one per
     * puzzle piece, or one per notation variant); get back an
     * array of finished SVG strings in the same order (entries
     * can be null if a snippet failed to render).
     *
     * anchorSelector is passed straight through to
     * prepareMiniMeasure - use "g.measure" (the default) for
     * single isolated measures, or "g.system" for multi-measure
     * phrases.
     */
    function renderMiniMeasureSet(miniXMLList, anchorSelector) {

        const prepared = prepareAllForSharedScale(
            miniXMLList, anchorSelector
        );

        const canvas = computeSharedCanvas(prepared);

        return prepared.map(function (p) {

            if (!p) {
                return null;
            }

            return finalizeMiniMeasure(
                p, canvas.width, canvas.height
            );

        });

    }


    /*
     * Same as renderMiniMeasureSet, but ALSO returns each
     * snippet's own toolkit instance alongside its finished SVG,
     * instead of discarding it. Needed anywhere playback needs to
     * highlight notes in sync with a SPECIFIC rendered tile - e.g.
     * Choose a Chord's answer options - since a fresh toolkit's
     * note IDs are only guaranteed to match a rendering produced
     * by that EXACT same toolkit instance, not a different one
     * loaded with identical XML. Returns an array of
     * { svg, toolkit } (both null for an entry that failed).
     */
    function renderMiniMeasureSetWithToolkits(miniXMLList, anchorSelector) {

        const prepared = prepareAllForSharedScale(
            miniXMLList, anchorSelector
        );

        const canvas = computeSharedCanvas(prepared);

        return prepared.map(function (p) {

            if (!p) {
                return { svg: null, toolkit: null };
            }

            return {
                svg: finalizeMiniMeasure(p, canvas.width, canvas.height),
                toolkit: p.toolkit
            };

        });

    }


    /*
     * Shared helper for both functions above: prepares every
     * snippet (without finalizing a size yet).
     */
    function prepareAllForSharedScale(miniXMLList, anchorSelector) {

        return miniXMLList.map(function (xml) {

            try {
                return prepareMiniMeasure(xml, anchorSelector);
            }
            catch (error) {
                console.error("Error preparing a snippet:", error);
                return null;
            }

        });

    }


    /*
     * Shared helper: the common canvas size for a whole set,
     * based on whichever prepared snippet is largest.
     */
    function computeSharedCanvas(prepared) {

        const validBoxes = prepared
            .filter(function (p) {
                return p !== null;
            })
            .map(function (p) {
                return p.box;
            });

        const maxContentWidth =
            validBoxes.length > 0
                ? Math.max.apply(
                    null,
                    validBoxes.map(function (b) { return b.width; })
                )
                : 0;

        const maxContentHeight =
            validBoxes.length > 0
                ? Math.max.apply(
                    null,
                    validBoxes.map(function (b) { return b.height; })
                )
                : 0;

        /*
         * Padding is proportional to the LARGEST piece in this
         * set - every piece then shares that same canvas. Kept
         * deliberately tight: since every tile's on-screen pixel
         * size is fixed by CSS regardless of this canvas size,
         * less padding here means the actual notation fills more
         * of that fixed box - i.e. bigger, more legible notation,
         * not just a smaller margin.
         */
        const paddingX = Math.max(maxContentWidth * 0.03, 12);
        const paddingY = Math.max(maxContentHeight * 0.06, 12);

        return {
            width: maxContentWidth + paddingX * 2,
            height: maxContentHeight + paddingY * 2
        };

    }


    /*
     * =================================================
     * ARPEGGIATE A BLOCK CHORD
     * =================================================
     */

    /*
     * Takes a standalone one-measure MusicXML document containing
     * a block chord (several simultaneous notes) and returns a
     * NEW one-measure document with those same pitches played one
     * at a time, low to high, as sequential quarter notes. Used
     * so a simple chord file (just the solid chord, nothing else)
     * is enough on its own - there's no need to separately
     * hand-author a "played one at a time" version of every chord.
     *
     * Only the first simultaneous group of notes is used (so a
     * chord written twice in a row, e.g. as two half notes, still
     * arpeggiates just the three or four actual chord tones, not
     * six or eight).
     */
    function arpeggiateChordXML(musicXML) {

        const parser = new DOMParser();

        const doc = parser.parseFromString(musicXML, "application/xml");

        const part = doc.querySelector("part");

        const firstMeasure = part.querySelector("measure");

        const notes =
            Array.from(firstMeasure.querySelectorAll(":scope > note"));

        /*
         * Find the first actual pitched note (skipping any rests
         * that might precede it on another staff/voice).
         */
        let startIndex = -1;

        for (let i = 0; i < notes.length; i++) {

            if (notes[i].querySelector("pitch")) {
                startIndex = i;
                break;
            }

        }

        if (startIndex === -1) {
            throw new Error("No pitched notes found to arpeggiate.");
        }

        /*
         * Collect that note plus every note immediately after it
         * marked <chord/> - i.e. everything sounding at that same
         * instant. Stops at the first note that ISN'T part of the
         * same chord (e.g. the start of a repeat).
         */
        const chordNotes = [notes[startIndex]];

        for (let i = startIndex + 1; i < notes.length; i++) {

            if (notes[i].querySelector(":scope > chord")) {
                chordNotes.push(notes[i]);
            }
            else {
                break;
            }

        }

        /*
         * Sort low to high - the natural order for "spelling out"
         * a chord.
         */
        const stepOrder = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

        function pitchHeight(noteEl) {

            const pitch = noteEl.querySelector("pitch");
            const step = pitch.querySelector("step").textContent;
            const alterEl = pitch.querySelector("alter");
            const alter = alterEl ? parseInt(alterEl.textContent, 10) : 0;
            const octave =
                parseInt(pitch.querySelector("octave").textContent, 10);

            return octave * 12 + stepOrder[step] + alter;

        }

        const sortedChordNotes = chordNotes.slice().sort(function (a, b) {
            return pitchHeight(a) - pitchHeight(b);
        });

        /*
         * Which staff the chord actually lives on, so the right
         * clef carries over (these files commonly put the chord
         * on either staff, with the other staff just resting).
         */
        const staffEl = sortedChordNotes[0].querySelector("staff");
        const staffNumber = staffEl ? staffEl.textContent : "1";

        const attributes = firstMeasure.querySelector("attributes");

        const clefs =
            attributes
                ? Array.from(attributes.querySelectorAll("clef"))
                : [];

        let matchingClef = clefs.find(function (c) {
            return c.getAttribute("number") === staffNumber;
        });

        if (!matchingClef && clefs.length > 0) {
            matchingClef = clefs[0];
        }

        /*
         * Build the new one-measure document: one quarter note per
         * chord tone, in a time signature sized to exactly fit
         * however many notes the chord has.
         */
        const newDoc =
            document.implementation.createDocument(
                null, "score-partwise", null
            );

        const root = newDoc.documentElement;

        root.setAttribute("version", "4.0");

        const partList = doc.querySelector("part-list");

        if (partList) {
            root.appendChild(newDoc.importNode(partList, true));
        }

        const newPart = newDoc.createElement("part");

        newPart.setAttribute(
            "id", part.getAttribute("id") || "P1"
        );

        const newMeasure = newDoc.createElement("measure");

        newMeasure.setAttribute("number", "1");

        const newAttributes = newDoc.createElement("attributes");

        const divisionsEl = newDoc.createElement("divisions");
        divisionsEl.textContent = "1";
        newAttributes.appendChild(divisionsEl);

        /*
         * Copy the SOURCE file's actual key signature, rather
         * than assuming "no sharps or flats" - that happened to
         * be correct for every chord so far, but would silently
         * produce a wrong key signature the moment a chord in a
         * real key gets added.
         */
        const sourceKey = attributes ? attributes.querySelector("key") : null;

        if (sourceKey) {
            newAttributes.appendChild(newDoc.importNode(sourceKey, true));
        }
        else {
            const keyEl = newDoc.createElement("key");
            const fifthsEl = newDoc.createElement("fifths");
            fifthsEl.textContent = "0";
            keyEl.appendChild(fifthsEl);
            newAttributes.appendChild(keyEl);
        }

        const timeEl = newDoc.createElement("time");
        const beatsEl = newDoc.createElement("beats");
        beatsEl.textContent = String(sortedChordNotes.length);
        const beatTypeEl = newDoc.createElement("beat-type");
        beatTypeEl.textContent = "4";
        timeEl.appendChild(beatsEl);
        timeEl.appendChild(beatTypeEl);
        newAttributes.appendChild(timeEl);

        if (matchingClef) {

            const newClef = newDoc.importNode(matchingClef, true);

            /*
             * The source clef is numbered for ITS staff (e.g.
             * number="2" for a bass clef in a two-staff piano
             * part). This new document only has ONE staff, so
             * that clef needs to be renumbered to "1" - otherwise
             * Verovio has nothing to attach a "clef for staff 2"
             * to in a single-staff document, and silently falls
             * back to a default treble clef instead of using the
             * one we actually copied over.
             */
            newClef.setAttribute("number", "1");

            newAttributes.appendChild(newClef);

        }

        newMeasure.appendChild(newAttributes);

        /*
         * Maps a <alter> value to the matching MusicXML
         * <accidental> name.
         */
        const accidentalNames = {
            "-2": "flat-flat",
            "-1": "flat",
            "1": "sharp",
            "2": "double-sharp"
        };

        sortedChordNotes.forEach(function (noteEl) {

            const pitch = noteEl.querySelector("pitch");

            const newNote = newDoc.createElement("note");

            newNote.appendChild(newDoc.importNode(pitch, true));

            const durationEl = newDoc.createElement("duration");
            durationEl.textContent = "1";
            newNote.appendChild(durationEl);

            const typeEl = newDoc.createElement("type");
            typeEl.textContent = "quarter";
            newNote.appendChild(typeEl);

            /*
             * <alter> alone (already copied above, inside <pitch>)
             * correctly controls the SOUND, but whether a visible
             * sharp/flat symbol gets printed is a separate,
             * explicit decision. Rather than relying on Verovio to
             * infer the right symbol here, state it directly - a
             * block chord and these same pitches played as
             * separate sequential notes can otherwise end up with
             * different accidental-placement logic applied, even
             * though the underlying pitches are identical.
             */
            const alterEl = pitch.querySelector("alter");

            const alterValue = alterEl ? alterEl.textContent.trim() : "0";

            if (accidentalNames[alterValue]) {

                const accidentalEl = newDoc.createElement("accidental");
                accidentalEl.textContent = accidentalNames[alterValue];
                newNote.appendChild(accidentalEl);

            }

            newMeasure.appendChild(newNote);

        });

        newPart.appendChild(newMeasure);
        root.appendChild(newPart);

        return new XMLSerializer().serializeToString(newDoc);

    }


    /*
     * =================================================
     * PUBLIC API
     * =================================================
     */

    /*
     * =================================================
     * COMBINE SEVERAL ONE-MEASURE DOCUMENTS INTO ONE
     * =================================================
     */

    /*
     * Takes an array of standalone one-measure MusicXML strings
     * (e.g. rhythm blocks a player has assembled into a sequence)
     * and combines them into a single playable multi-measure
     * document. Unlike makeReorderedMusicXML, these snippets don't
     * have to come from the same original piece - each one is its
     * own self-contained file.
     */
    function combineMeasures(xmlSnippetList) {

        const parser = new DOMParser();

        const newDoc =
            document.implementation.createDocument(
                null, "score-partwise", null
            );

        const root = newDoc.documentElement;

        root.setAttribute("version", "3.1");

        if (xmlSnippetList.length === 0) {
            return new XMLSerializer().serializeToString(newDoc);
        }

        /*
         * Every block is authored as its own standalone document,
         * so every one of them carries a <part-list>. They should
         * all agree (same instrument), so we just use the first
         * block's.
         */
        const firstDoc =
            parser.parseFromString(xmlSnippetList[0], "application/xml");

        const partList = firstDoc.querySelector("part-list");

        if (partList) {
            root.appendChild(newDoc.importNode(partList, true));
        }

        const firstPart = firstDoc.querySelector("part");

        const newPart = newDoc.createElement("part");

        newPart.setAttribute(
            "id",
            firstPart ? (firstPart.getAttribute("id") || "P1") : "P1"
        );

        xmlSnippetList.forEach(function (xml, index) {

            const doc = parser.parseFromString(xml, "application/xml");

            const measure = doc.querySelector("part > measure");

            if (!measure) {
                return;
            }

            const imported = newDoc.importNode(measure, true);

            imported.setAttribute("number", String(index + 1));

            /*
             * Each block carries its own <attributes> (clef, key,
             * time), since it's authored as a standalone document.
             * Once combined, only the very first measure needs to
             * declare them - repeating the identical clef/key/time
             * on every measure would just clutter the rendering.
             */
            if (index > 0) {

                const attributes =
                    imported.querySelector(":scope > attributes");

                if (attributes) {
                    imported.removeChild(attributes);
                }

            }

            newPart.appendChild(imported);

        });

        root.appendChild(newPart);

        return new XMLSerializer().serializeToString(newDoc);

    }


    /*
     * =================================================
     * PUBLIC API
     * =================================================
     */

    return {
        ready: ready,
        loadMusicXML: loadMusicXML,
        loadCatalog: loadCatalog,
        countMeasures: countMeasures,
        getMeasureSignatures: getMeasureSignatures,
        renderScore: renderScore,
        playMIDI: playMIDI,
        playMusicXML: playMusicXML,
        stopMIDI: stopMIDI,
        attachHighlighting: attachHighlighting,
        makeMiniMusicXML: makeMiniMusicXML,
        makeExcerptMusicXML: makeExcerptMusicXML,
        makeReorderedMusicXML: makeReorderedMusicXML,
        renderMiniMeasureSet: renderMiniMeasureSet,
        renderMiniMeasureSetWithToolkits: renderMiniMeasureSetWithToolkits,
        combineMeasures: combineMeasures,
        arpeggiateChordXML: arpeggiateChordXML
    };


})();
