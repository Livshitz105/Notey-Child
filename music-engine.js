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
            box: box
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

        const prepared = miniXMLList.map(function (xml) {

            try {
                return prepareMiniMeasure(xml, anchorSelector);
            }
            catch (error) {
                console.error("Error preparing a snippet:", error);
                return null;
            }

        });

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
         * puzzle - every piece then shares that same canvas.
         */
        const paddingX = Math.max(maxContentWidth * 0.06, 20);
        const paddingY = Math.max(maxContentHeight * 0.12, 20);

        const canvasWidth = maxContentWidth + paddingX * 2;
        const canvasHeight = maxContentHeight + paddingY * 2;

        return prepared.map(function (p) {

            if (!p) {
                return null;
            }

            return finalizeMiniMeasure(p, canvasWidth, canvasHeight);

        });

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
        renderScore: renderScore,
        playMIDI: playMIDI,
        playMusicXML: playMusicXML,
        stopMIDI: stopMIDI,
        attachHighlighting: attachHighlighting,
        makeMiniMusicXML: makeMiniMusicXML,
        makeReorderedMusicXML: makeReorderedMusicXML,
        renderMiniMeasureSet: renderMiniMeasureSet
    };


})();
