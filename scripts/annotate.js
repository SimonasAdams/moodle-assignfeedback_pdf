/*global ContextMenu*/ // MooTools classes
/*global Raphael*/
/*global document, confirm, alert, Image, window, top, setTimeout */ // Standard Javascript elements
/*global server_config */
function uploadpdf_init(Y) {
    "use strict";
    Y.Get.js([
        'scripts/contextmenu.js',
        'scripts/raphael-min.js'],
        function () {

            var YH, currentcomment, editbox, resizing, server, context_quicklist, context_comment, quicklist,
                pagelist, waitingforpage, pagestopreload, pagesremaining, pageunloading, lasthighlight, colourmenu, linecolourmenu,
                nextbutton, prevbutton, choosedrawingtool, findcommentsmenu, stampmenu, resendtimeout, currentpaper, currentline,
                linestartpos, freehandpoints, allannotations, LINEWIDTH, HIGHLIGHT_LINEWIDTH, $defined;

            if (typeof YAHOO === 'undefined') {
                YH = Y.YUI2;
            } else {
                YH = YAHOO;
            }

            currentcomment = null; // The comment that is currently being edited.
            editbox = null; // The edit box that is currently displayed.
            server = null; // The object use to send data back to the server.
            context_quicklist = null;
            context_comment = null;
            quicklist = null; // Stores all the comments in the quicklist.
            pagelist = []; // Stores all the data for the preloaded pages.
            waitingforpage = -1;  // Waiting for this page from the server - display as soon as it is received.
            pagestopreload = 4; // How many pages ahead to load when you hit a non-preloaded page.
            pagesremaining = pagestopreload; // How many more pages to preload before waiting.
            pageunloading = false;
            lasthighlight = null; // The last comment highlighted via 'find comment'.

            // Toolbar buttons / menus.
            colourmenu = null;
            linecolourmenu = null;
            nextbutton = null;
            prevbutton = null;
            choosedrawingtool = null;
            findcommentsmenu = null;
            stampmenu = null;

            resendtimeout = 4000; // How long to wait before resending a comment.

            // All to do with line drawing.
            currentpaper = null;
            currentline = null;
            linestartpos = null;
            freehandpoints = null;

            allannotations = [];

            LINEWIDTH = 3.0;
            HIGHLIGHT_LINEWIDTH = 14.0;

            $defined = function (obj) { return (obj !== undefined && obj !== null); };

            function hidesendfailed() {
                Y.Event.purgeElement('#sendagain', false); // Throw away any remaining 'resend' calls.
                Y.one('#sendfailed').setStyle('display', 'none'); // Hide the popup.
            }

            function showsendfailed(resend) {
                if (pageunloading) {
                    return;
                }

                // If less than 2 failed messages since the last successful
                // message, then try again immediately
                if (server.retrycount < 2) {
                    server.retrycount += 1;
                    resend();
                    return;
                }

                Y.one('#sendagain').on('click', resend);
                Y.one('#sendagain').on('click', hidesendfailed);
                Y.one('#cancelsendagain').on('click', hidesendfailed);

                Y.one('#sendfailed').setStyle('display', 'block');
            }

            function showpage(pageno) {
                var pdfsize, style, pdfimg;
                pdfsize = Y.one('#pdfsize');
                pdfsize.setStyles({width: pagelist[pageno].width + 'px', height: pagelist[pageno].height + 'px'});
                pdfimg = Y.one('#pdfimg');
                pdfimg.set('width', pagelist[pageno].width);
                pdfimg.set('height', pagelist[pageno].height);
                if (pagelist[pageno].image.complete) {
                    pdfimg.set('src', pagelist[pageno].url);
                } else {
                    pdfimg.set('src', server_config.blank_image);
                    setTimeout(function () { check_pageimage(pageno); }, 200);
                }
                server.getcomments();
            }

            function updatepagenavigation(pageno) {
                var pagecount, opennew, on_link;
                pageno = parseInt(pageno, 10);
                pagecount = parseInt(server_config.pagecount, 10);

                // Set the dropdown selects to have the correct page number in them
                Y.one('#selectpage').set('value', pageno.toString());
                Y.one('#selectpage2').set('value', pageno.toString());

                if (server.editing) {
                    // Update the 'open in new window' link
                    opennew = Y.one('#opennewwindow');
                    on_link = opennew.get('href').replace(/pageno=\d+/, "pageno=" + pageno);
                    opennew.set('href', on_link);
                }

                //Update the next/previous buttons
                if (pageno === pagecount) {
                    nextbutton.set('disabled', true);
                    Y.one('#nextpage2').set('disabled', 'disabled');
                } else {
                    nextbutton.set('disabled', false);
                    Y.one('#nextpage2').removeAttribute('disabled');
                }
                if (pageno === 1) {
                    prevbutton.set('disabled', true);
                    Y.one('#prevpage2').set('disabled', 'disabled');
                } else {
                    prevbutton.set('disabled', false);
                    Y.one('#prevpage2').removeAttribute('disabled');
                }
            }

            function gotopage(pageno) {
                var pagecount, i;
                pageno = parseInt(pageno, 10);
                pagecount = parseInt(server_config.pagecount, 10);
                if ((pageno <= pagecount) && (pageno > 0)) {
                    Y.one('#pdfholder').all('.comment').remove(true); // Remove all the currently displayed comments
                    for (i = 0; i < allannotations.length; i += 1) {
                        allannotations[i].remove(true); // Remove all the currently displayed annotations.
                    }
                    allannotations.length = 0; // Clear the list.
                    abortline(); // Abandon any lines currently being drawn
                    currentcomment = null; // Throw away any comments in progress
                    editbox = null;
                    lasthighlight = null;

                    updatepagenavigation(pageno);

                    server.pageno = pageno.toString();
                    server.pageloadcount += 1;
                    server.getimageurl(pageno, true);
                }
            }

            function gotonextpage() {
                var pageno = parseInt(server.pageno, 10);
                pageno += 1;
                gotopage(pageno);
            }

            function gotoprevpage() {
                var pageno = parseInt(server.pageno, 10);
                pageno -= 1;
                gotopage(pageno);
            }

            function selectpage() {
                gotopage(Y.one('#selectpage').get('value'));
            }

            function selectpage2() {
                gotopage(Y.one('#selectpage2').get('value'));
            }

            function updatefindcomments(page, id, text) {
                if (!server.editing) {
                    return;
                }
                if (text.length > 40) {
                    text = page + ': ' + text.substring(0, 39) + '&hellip;';
                } else {
                    text = page + ': ' + text;
                }

                var value, menu, items, i, details, itempage, itemid;

                id = parseInt(id, 10);
                page = parseInt(page, 10);
                value = page + ':' + id;
                menu = findcommentsmenu.getMenu();
                items = menu.getItems();
                for (i = 0; i < items.length; i += 1) {
                    if ($defined(items[i].value)) {
                        details = items[i].value.split(':');
                        itempage = parseInt(details[0], 10);
                        itemid = parseInt(details[1], 10);
                        if (itemid === 0) { // 'No comments'
                            items[i].value = page + ':' + id;
                            items[i].cfg.setProperty('text', text);
                            return;
                        }
                        if (itemid === id) {
                            items[i].cfg.setProperty('text', text);
                            return;
                        }
                        if (itempage > page) {
                            menu.insertItem({text: text, value: value}, parseInt(i, 10));
                            return;
                        }
                    }
                }
                menu.addItem({text: text, value: value});
            }

            function removefromfindcomments(id) {
                if (!server.editing) {
                    return;
                }
                var menu, items, i, itemid;
                id = parseInt(id, 10);
                menu = findcommentsmenu.getMenu();
                items = menu.getItems();
                for (i = 0; i < items.length; i += 1) {
                    if ($defined(items[i].value)) {
                        itemid = parseInt(items[i].value.split(':')[1], 10);
                        if (itemid === id) {
                            if (items.length === 1) {
                                // Only item in list - set it to 'no comments'
                                items[i].cfg.setProperty('text', server_config.lang_nocomments);
                                items[i].value = '0:0';
                            } else {
                                menu.removeItem(items[i]);
                            }
                            return;
                        }
                    }
                }
            }

            function setcolourclass(colour, comment) {
                if (comment) {
                    comment.removeClass('commentred').removeClass('commentgreen').removeClass('commentblue').
                        removeClass('commentwhite').removeClass('commentclear').removeClass('commentyellow');
                    if (colour === 'red') {
                        comment.addClass('commentred');
                    } else if (colour === 'green') {
                        comment.addClass('commentgreen');
                    } else if (colour === 'blue') {
                        comment.addClass('commentblue');
                    } else if (colour === 'white') {
                        comment.addClass('commentwhite');
                    } else if (colour === 'clear') {
                        comment.addClass('commentclear');
                    } else {
                        // Default: yellow comment box
                        comment.addClass('commentyellow');
                        colour = 'yellow';
                    }
                    comment.setData('colour', colour);
                }
            }

            function getcurrentcolour() {
                if (!server.editing) {
                    return 'yellow';
                }
                return colourmenu.get("value");
            }

            function changecolour() {
                if (!server.editing) {
                    return;
                }
                if (currentcomment) {
                    var col = getcurrentcolour();
                    if (col !== currentcomment.getData('colour')) {
                        setcolourclass(getcurrentcolour(), currentcomment);
                    }
                }
                Y.Cookie.set('feedbackpdf_colour', getcurrentcolour());
            }

            function setcurrentcolour(colour) {
                if (!server.editing) {
                    return;
                }
                if (colour !== 'red' && colour !== 'green' && colour !== 'blue' && colour !== 'white' && colour !== 'clear') {
                    colour = 'yellow';
                }
                colourmenu.set("label", '<img src="' + server_config.image_path + colour + '.gif" />');
                colourmenu.set("value", colour);
                changecolour();
            }

            function nextcommentcolour() {
                switch (getcurrentcolour()) {
                case 'red':
                    setcurrentcolour('yellow');
                    break;
                case 'yellow':
                    setcurrentcolour('green');
                    break;
                case 'green':
                    setcurrentcolour('blue');
                    break;
                case 'blue':
                    setcurrentcolour('white');
                    break;
                case 'white':
                    setcurrentcolour('clear');
                    break;
                }
            }

            function prevcommentcolour() {
                switch (getcurrentcolour()) {
                case 'yellow':
                    setcurrentcolour('red');
                    break;
                case 'green':
                    setcurrentcolour('yellow');
                    break;
                case 'blue':
                    setcurrentcolour('green');
                    break;
                case 'white':
                    setcurrentcolour('blue');
                    break;
                case 'clear':
                    setcurrentcolour('white');
                    break;
                }
            }

            function updatecommentcolour(colour, comment) {
                if (!server.editing) {
                    return;
                }
                if (colour !== comment.getData('colour')) {
                    setcolourclass(colour, comment);
                    setcurrentcolour(colour);
                    if (comment !== currentcomment) {
                        server.updatecomment(comment);
                    }
                }
            }

            function setcommentcontent(el, content) {
                el.setData('rawtext', content);

                // Replace special characters with html entities
                content = content.replace(/</gi, '&lt;');
                content = content.replace(/>/gi, '&gt;');
                if (Y.UA.ie == 7) { // Grrr... no 'pre-wrap'
                    content = content.replace(/\n/gi, '<br/>');
                    content = content.replace(/ {2}/gi, ' &nbsp;');
                }
                var contentel = el.one('.content');
                contentel.setContent(content);
            }

            function typingcomment(e) {
                if (!server.editing) {
                    return;
                }
                if (e.keyCode === 27) { // 'Esc' key pressed.
                    updatelastcomment();
                    e.preventDefault();
                    e.stopPropagation();
                }
            }

            function updatelastcomment() {
                if (!server.editing) {
                    return false;
                }
                // Stop trapping 'escape'
                Y.Event.detach('keydown', typingcomment, Y.one('document'));

                var updated, content, id, oldcolour, newcolour, oldcontent;
                updated = false;
                content = null;
                if (editbox !== null) {
                    content = editbox.get('value');
                    editbox.remove(true);
                    editbox = null;
                }
                if (currentcomment !== null) {
                    if (content === null || (content.trim() === '')) {
                        id = currentcomment.getData('id');
                        if (id !== -1) {
                            server.removecomment(id);
                        }
                        currentcomment.remove(true);

                    } else {
                        oldcolour = currentcomment.getData('oldcolour');
                        newcolour = currentcomment.getData('colour');
                        oldcontent = currentcomment.getData('rawtext');
                        setcommentcontent(currentcomment, content);
                        if ((content !== oldcontent) || (newcolour !== oldcolour)) {
                            server.updatecomment(currentcomment);
                        }
                    }
                    currentcomment = null;
                    updated = true;
                }

                return updated;
            }

            function makeeditbox(comment, content) {
                if (!server.editing) {
                    return;
                }

                if (!$defined(content)) {
                    content = '';
                }

                editbox = Y.Node.create('<textarea></textarea>');
                editbox.set('rows', '5');
                editbox.set('wrap', 'soft');
                editbox.set('value', content);
                comment.appendChild(editbox);
                editbox.focus();

                Y.one('document').on('keydown', typingcomment);
            }

            function editcomment(e) {
                if (!server.editing) {
                    return;
                }
                if (currentcomment === e.currentTarget) {
                    return;
                }
                updatelastcomment();

                currentcomment = e.currentTarget;
                var content;
                currentcomment.one('.content').setContent('');
                content = currentcomment.getData('rawtext');
                makeeditbox(currentcomment, content);
                setcurrentcolour(currentcomment.getData('colour'));
            }

            function makecommentbox(position, content, colour) {
                // Create the comment box
                var newcomment, drag, resize, mootoolsel;
                newcomment = Y.Node.create('<div><div class="content"></div></div>');
                Y.one('#pdfholder').appendChild(newcomment);

                if (position.x < 0) {
                    position.x = 0;
                }
                if (position.y < 0) {
                    position.y = 0;
                }

                newcomment.addClass('comment');
                if (colour !== undefined) {
                    setcolourclass(colour, newcomment);
                } else {
                    setcolourclass(getcurrentcolour(), newcomment);
                }
                newcomment.setData('oldcolour', colour);
                newcomment.setStyles({ left: position.x + 'px', top: position.y + 'px', position: 'absolute'});
                newcomment.setData('id', -1);

                if (server.editing) {
                    if (context_comment) {
                        context_comment.addmenu(newcomment);
                    }

                    newcomment.on('click', editcomment);
                    drag = new Y.DD.Drag({
                        node: newcomment
                    });
                    drag.plug(Y.Plugin.DDConstrained, {
                        constrain: '#pdfholder'
                    });
                    drag.on('drag:end', function (e) {
                        if (!editbox) { // No updates whilst editing the text.
                            server.updatecomment(newcomment);
                        }
                    });

                    // Add the edit box to it
                    resize = new Y.Resize({
                        node: newcomment,
                        handles: 'r'
                    });
                    resize.plug(Y.Plugin.ResizeConstrained, {
                        constrain: '#pdfholder'
                    });
                    resize.after('resize:resize', function (e) {
                        newcomment.setStyle('height', '');
                    });
                    resize.after('resize:end', function (e) {
                        newcomment.setStyle('height', '');
                        if (!$defined(editbox)) {
                            // Do not update the server when resizing whilst editing text.
                            server.updatecomment(newcomment);
                        }
                    });
                    if ($defined(content)) {
                        setcommentcontent(newcomment, content);
                    } else {
                        makeeditbox(newcomment);
                    }
                } else {  // !server.editing
                    if ($defined(content)) { // Really should always be the case
                        setcommentcontent(newcomment, content);
                    }
                }

                return newcomment;
            }

            function abortline() {
                if (!server.editing) {
                    return;
                }
                if (currentline) {
                    Y.Event.detach('mousemove', updateline, Y.one('document'));
                    Y.Event.detach('mouseup', finishline, Y.one('document'));
                    if ($defined(currentpaper)) {
                        currentpaper.remove();
                        currentpaper = null;
                    }
                    currentline = null;
                }
            }

            function getcurrenttool() {
                if (!server.editing) {
                    return 'comment';
                }
                return choosedrawingtool.get("value").replace('icon', '');
            }

            function setcurrenttool(toolname) {
                if (!server.editing) {
                    return;
                }
                Y.Cookie.set('feedbackpdf_tool', toolname);
                abortline(); // Just in case we are in the middle of drawing, when we change tools
                updatelastcomment();
                toolname += 'icon';
                var btns, count, idx, i;
                btns = choosedrawingtool.getButtons();
                count = choosedrawingtool.getCount();
                idx = 0;
                for (i = 0; i < count; i += 1) {
                    if (btns[i].get("value") === toolname) {
                        idx = i;
                    }
                }
                choosedrawingtool.check(idx);
                choosedrawingtool.set('value', btns[idx].get('value'));
            }

            function getcurrentlinecolour() {
                if (!server.editing) {
                    return 'red';
                }
                return linecolourmenu.get("value");
            }

            function changelinecolour() {
                if (!server.editing) {
                    return;
                }
                Y.Cookie.set('feedbackpdf_linecolour', getcurrentlinecolour());
            }

            function setcurrentlinecolour(colour) {
                if (!server.editing) {
                    return;
                }
                if (colour !== 'yellow' && colour !== 'green' && colour !== 'blue' && colour !== 'white' && colour !== 'black') {
                    colour = 'red';
                }
                linecolourmenu.set("label", '<img src="' + server_config.image_path + 'line' + colour + '.gif" />');
                linecolourmenu.set("value", colour);
                changelinecolour();
            }

            function nextlinecolour() {
                switch (getcurrentlinecolour()) {
                case 'red':
                    setcurrentlinecolour('yellow');
                    break;
                case 'yellow':
                    setcurrentlinecolour('green');
                    break;
                case 'green':
                    setcurrentlinecolour('blue');
                    break;
                case 'blue':
                    setcurrentlinecolour('white');
                    break;
                case 'white':
                    setcurrentlinecolour('black');
                    break;
                }
            }

            function prevlinecolour() {
                switch (getcurrentlinecolour()) {
                case 'yellow':
                    setcurrentlinecolour('red');
                    break;
                case 'green':
                    setcurrentlinecolour('yellow');
                    break;
                case 'blue':
                    setcurrentlinecolour('green');
                    break;
                case 'white':
                    setcurrentlinecolour('blue');
                    break;
                case 'black':
                    setcurrentlinecolour('white');
                    break;
                }
            }

            function setlinecolour(colour, line, currenttool) {
                if (line) {
                    var rgb;
                    if (currenttool === 'highlight') {
                        if (colour === "yellow") {
                            rgb = "#ffffb0";
                        } else if (colour === "green") {
                            rgb = "#b0ffb0";
                        } else if (colour === "blue") {
                            rgb = "#d0d0ff";
                        } else if (colour === "white") {
                            rgb = "#ffffff";
                        } else if (colour === "black") {
                            rgb = "#323232";
                        } else {
                            rgb = "#ffb0b0"; // Red
                        }
                        line.attr("fill", rgb);
                        line.attr("opacity", 0.5);
                    } else {
                        if (colour === "yellow") {
                            rgb = "#ff0";
                        } else if (colour === "green") {
                            rgb = "#0f0";
                        } else if (colour === "blue") {
                            rgb = "#00f";
                        } else if (colour === "white") {
                            rgb = "#fff";
                        } else if (colour === "black") {
                            rgb = "#000";
                        } else {
                            rgb = "#f00"; // Red
                        }
                    }
                    line.attr("stroke", rgb);
                }
            }

            function getcurrentstamp() {
                if (!server.editing) {
                    return '';
                }
                return stampmenu.get("value");
            }

            function getstampimage(stamp) {
                return server_config.image_path + 'stamps/' + stamp + '.png';
            }

            function changestamp(e) {
                if (!server.editing) {
                    return;
                }
                Y.Cookie.set('feedbackpdf_stamp', getcurrentstamp());
                if (e !== false) {
                    setcurrenttool('stamp');
                }
            }

            function setcurrentstamp(stamp, settool) {
                if (!server.editing) {
                    return;
                }
                // Check valid stamp?
                stampmenu.set("label", '<img width="32" height="32" src="' + getstampimage(stamp) + '" />');
                stampmenu.set("value", stamp);
                if (settool === undefined) {
                    settool = true;
                }
                changestamp(settool);
            }

            function get_pdf_dims() {
                var pdf, dims;
                pdf = Y.one('#pdfimg');
                dims = {
                    width: parseInt(pdf.getComputedStyle('width'), 10),
                    height: parseInt(pdf.getComputedStyle('height'), 10),
                    left: pdf.getX(),
                    top: pdf.getY()
                };
                return dims;
            }

            function finishline(e) {
                if (!server.editing) {
                    return;
                }
                Y.Event.detach('mousemove', updateline, Y.one('document'));
                Y.Event.detach('mouseup', finishline, Y.one('document'));

                if (!$defined(currentpaper)) {
                    return;
                }

                var dims, coords, tool;
                dims = get_pdf_dims();
                tool = getcurrenttool();
                if (tool === 'freehand') {
                    coords = freehandpoints;
                } else {
                    coords = {sx: linestartpos.x, sy: linestartpos.y, ex: (e.pageX - dims.left), ey: (e.pageY - dims.top)};
                    if (coords.ex > dims.width) {
                        coords.ex = dims.width;
                    }
                    if (coords.ex < 0) {
                        coords.ex = 0;
                    }
                    if (coords.ey > dims.height) {
                        coords.ey = dims.height;
                    }
                    if (coords.ey < 0) {
                        coords.ey = 0;
                    }
                }

                currentpaper.remove();
                currentpaper = null;
                currentline = null;

                makeline(coords, tool);
            }

            function updateline(e) {
                if (!server.editing) {
                    return;
                }

                var dims, ex, ey, currenttool, w, h, sx, sy, rx, ry, dx, dy, dist;

                dims = get_pdf_dims();
                ex = e.pageX - dims.left;
                ey = e.pageY - dims.top;

                if (ex > dims.width) {
                    ex = dims.width;
                }
                if (ex < 0) {
                    ex = 0;
                }
                if (ey > dims.height) {
                    ey = dims.height;
                }
                if (ey < 0) {
                    ey = 0;
                }

                currenttool = getcurrenttool();

                if ($defined(currentline) && currenttool !== 'freehand') {
                    currentline.remove();
                } else {
                    // Doing this earlier catches the starting mouse click by mistake
                    Y.one('document').on('mouseup', finishline);
                }

                switch (currenttool) {
                case 'rectangle':
                    w = Math.abs(ex - linestartpos.x);
                    h = Math.abs(ey - linestartpos.y);
                    sx = Math.min(linestartpos.x, ex);
                    sy = Math.min(linestartpos.y, ey);
                    currentline = currentpaper.rect(sx, sy, w, h);
                    break;
                case 'oval':
                    rx = Math.abs(ex - linestartpos.x) / 2;
                    ry = Math.abs(ey - linestartpos.y) / 2;
                    sx = Math.min(linestartpos.x, ex) + rx; // Add 'rx'/'ry' to get to the middle
                    sy = Math.min(linestartpos.y, ey) + ry;
                    currentline = currentpaper.ellipse(sx, sy, rx, ry);
                    break;
                case 'freehand':
                    dx = linestartpos.x - ex;
                    dy = linestartpos.y - ey;
                    dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 2) { // Trying to reduce the number of points a bit
                        return;
                    }
                    currentline = currentpaper.path("M " + linestartpos.x + " " + linestartpos.y + "L" + ex + " " + ey);
                    freehandpoints.push({x: ex, y: ey});
                    linestartpos.x = ex;
                    linestartpos.y = ey;
                    break;
                case 'highlight':
                    w = Math.abs(ex - linestartpos.x);
                    h = HIGHLIGHT_LINEWIDTH;
                    sx = Math.min(linestartpos.x, ex);
                    sy = linestartpos.y - 0.5 * HIGHLIGHT_LINEWIDTH;
                    currentline = currentpaper.rect(sx, sy, w, h);
                    break;
                case 'stamp':
                    w = Math.abs(ex - linestartpos.x);
                    h = Math.abs(ey - linestartpos.y);
                    sx = Math.min(linestartpos.x, ex);
                    sy = Math.min(linestartpos.y, ey);
                    currentline = currentpaper.image(getstampimage(getcurrentstamp()), sx, sy, w, h);
                    break;
                default: // Comment + Ctrl OR line
                    currentline = currentpaper.path("M " + linestartpos.x + " " + linestartpos.y + "L" + ex + " " + ey);
                    break;
                }
                if (currenttool === 'highlight') {
                    currentline.attr("stroke-width", 0);
                } else {
                    currentline.attr("stroke-width", LINEWIDTH);
                }
                setlinecolour(getcurrentlinecolour(), currentline, currenttool);
            }

            function startline(e) {
                if (!server.editing) {
                    return true;
                }
                if (e.button !== 1) { // Left button only
                    return true;
                }

                if (currentpaper) {
                    return true; // If user clicks very quickly this can happen
                }

                var tool, modifier, dims, sx, sy;
                tool = getcurrenttool();

                modifier = (Y.UA.os === 'macintosh') ? e.altKey : e.ctrlKey;
                if (tool === 'comment' && !modifier) {
                    return true;
                }
                if (tool === 'erase') {
                    return true;
                }

                if ($defined(currentcomment)) {
                    updatelastcomment();
                    return true;
                }

                context_quicklist.hide();
                context_comment.hide();

                e.preventDefault(); // Stop FF from dragging the image

                dims = get_pdf_dims();
                sx = e.pageX - dims.left;
                sy = e.pageY - dims.top;

                currentpaper = new Raphael(dims.left, dims.top, dims.width, dims.height);
                Y.one('document').on('mousemove', updateline);
                linestartpos = {x: sx, y: sy};
                if (tool === 'freehand') {
                    freehandpoints = [{x: linestartpos.x, y: linestartpos.y}];
                }
                if (tool === 'stamp') {
                    Y.one('document').on('mouseup', finishline); // Click without move = default sized stamp
                }

                return false;
            }

            function makeline(coords, type, id, colour, stamp) {
                var linewidth, halflinewidth, paper, line, details, boundary, container, i, maxx, maxy, minx, miny,
                    pathstr, temp, w, h, sx, sy, rx, ry, domcanvas;
                linewidth = LINEWIDTH;
                if (type === 'highlight') {
                    linewidth = 0;
                }
                halflinewidth = linewidth * 0.5;
                container = Y.Node.create('<span></span>');

                if (!$defined(colour)) {
                    colour = getcurrentlinecolour();
                }
                details = {type: type, colour: colour};

                if (type === 'freehand') {
                    details.path = coords[0].x + ',' + coords[0].y;
                    for (i = 1; i < coords.length; i += 1) {
                        details.path += ',' + coords[i].x + ',' + coords[i].y;
                    }

                    maxx = minx = coords[0].x;
                    maxy = miny = coords[0].y;
                    for (i = 1; i < coords.length; i += 1) {
                        minx = Math.min(minx, coords[i].x);
                        maxx = Math.max(maxx, coords[i].x);
                        miny = Math.min(miny, coords[i].y);
                        maxy = Math.max(maxy, coords[i].y);
                    }
                    boundary = {
                        x: (minx - (halflinewidth * 0.5)),
                        y: (miny - (halflinewidth * 0.5)),
                        w: (maxx + linewidth - minx),
                        h: (maxy + linewidth - miny)
                    };
                    if (boundary.h < 14) {
                        boundary.h = 14;
                    }
                    container.setStyles({
                        left: boundary.x + 'px',
                        top: boundary.y + 'px',
                        width: (boundary.w + 2) + 'px',
                        height: (boundary.h + 2) + 'px',
                        position: 'absolute'
                    });
                    Y.one('#pdfholder').appendChild(container);
                    paper = new Raphael(container.getDOMNode());
                    minx -= halflinewidth;
                    miny -= halflinewidth;

                    pathstr = 'M' + (coords[0].x - minx) + ' ' + (coords[0].y - miny);
                    for (i = 1; i < coords.length; i += 1) {
                        pathstr += 'L' + (coords[i].x - minx) + ' ' + (coords[i].y - miny);
                    }
                    line = paper.path(pathstr);
                } else {
                    if (type === 'stamp') {
                        if (Math.abs(coords.sx - coords.ex) < 4 && Math.abs(coords.sy - coords.ey) < 4) {
                            coords.ex = coords.sx + 40;
                            coords.ey = coords.sy + 40;
                        }
                    }
                    details.coords = { sx: coords.sx, sy: coords.sy, ex: coords.ex, ey: coords.ey };

                    if (coords.sx > coords.ex) { // Always go left->right
                        temp = coords.sx;
                        coords.sx = coords.ex;
                        coords.ex = temp;
                        temp = coords.sy;
                        coords.sy = coords.ey;
                        coords.ey = temp;
                    }
                    if (type === 'highlight') {
                        coords.sy -= HIGHLIGHT_LINEWIDTH * 0.5;
                        coords.ey = coords.sy + HIGHLIGHT_LINEWIDTH;
                    }
                    if (coords.sy < coords.ey) {
                        boundary = {
                            x: (coords.sx - (halflinewidth * 0.5)),
                            y: (coords.sy - (halflinewidth * 0.5)),
                            w: (coords.ex + linewidth - coords.sx),
                            h: (coords.ey + linewidth - coords.sy)
                        };
                        coords.sy = halflinewidth;
                        coords.ey = boundary.h - halflinewidth;
                    } else {
                        boundary = {
                            x: (coords.sx - (halflinewidth * 0.5)),
                            y: (coords.ey - (halflinewidth * 0.5)),
                            w: (coords.ex + linewidth - coords.sx),
                            h: (coords.sy + linewidth - coords.ey)
                        };
                        coords.sy = boundary.h - halflinewidth;
                        coords.ey = halflinewidth;
                    }
                    coords.sx = halflinewidth;
                    coords.ex = boundary.w - halflinewidth;
                    if (boundary.h < 14) {
                        boundary.h = 14;
                    }
                    container.setStyles({
                        left: boundary.x + 'px',
                        top: boundary.y + 'px',
                        width: (boundary.w + 2) + 'px',
                        height: (boundary.h + 2) + 'px',
                        position: 'absolute'
                    });
                    Y.one('#pdfholder').appendChild(container);
                    paper = new Raphael(container.getDOMNode());
                    switch (type) {
                    case 'rectangle':
                        w = Math.abs(coords.ex - coords.sx);
                        h = Math.abs(coords.ey - coords.sy);
                        sx = Math.min(coords.sx, coords.ex);
                        sy = Math.min(coords.sy, coords.ey);
                        line = paper.rect(sx, sy, w, h);
                        break;
                    case 'oval':
                        rx = Math.abs(coords.ex - coords.sx) / 2;
                        ry = Math.abs(coords.ey - coords.sy) / 2;
                        sx = Math.min(coords.sx, coords.ex) + rx;
                        sy = Math.min(coords.sy, coords.ey) + ry;
                        line = paper.ellipse(sx, sy, rx, ry);
                        break;
                    case 'highlight':
                        w = Math.abs(coords.ex - coords.sx);
                        h = HIGHLIGHT_LINEWIDTH;
                        sx = Math.min(coords.sx, coords.ex);
                        sy = Math.min(coords.sy, coords.ey);
                        line = paper.rect(sx, sy, w, h);
                        break;
                    case 'stamp':
                        w = Math.abs(coords.ex - coords.sx);
                        h = Math.abs(coords.ey - coords.sy);
                        sx = Math.min(coords.sx, coords.ex);
                        sy = Math.min(coords.sy, coords.ey);
                        if (!$defined(stamp)) {
                            stamp = getcurrentstamp();
                        }
                        line = paper.image(getstampimage(stamp), sx, sy, w, h);
                        details.path = stamp;
                        break;
                    default:
                        line = paper.path("M " + coords.sx + " " + coords.sy + " L " + coords.ex + " " + coords.ey);
                        details.type = 'line';
                        break;
                    }
                }
                line.attr("stroke-width", linewidth);
                setlinecolour(colour, line, type);

                domcanvas = Y.one(paper.canvas);

                domcanvas.setData('container', container);
                domcanvas.setData('width', boundary.w);
                domcanvas.setData('height', boundary.h);
                domcanvas.setData('line', line);
                domcanvas.setData('colour', colour);
                if (server.editing) {
                    domcanvas.on('mousedown', startline);
                    domcanvas.on('click', eraseline);
                    if ($defined(id)) {
                        domcanvas.setData('id', id);
                    } else {
                        server.addannotation(details, domcanvas);
                    }
                } else {
                    domcanvas.setData('id', id);
                }

                allannotations.push(container);
            }

            server = {
                id: null,
                submissionid: null,
                pageno: null,
                sesskey: null,
                url: null,
                retrycount: 0,
                editing: true,
                waitel: null,
                pageloadcount: 0,  // Store how many page loads there have been
                // (to allow ignoring of messages from server that arrive after page has changed)
                scrolltocommentid: 0,

                initialize: function (settings) {
                    this.id = settings.id;
                    this.submissionid = settings.submissionid;
                    this.pageno = settings.pageno;
                    this.sesskey = settings.sesskey;
                    this.url = settings.updatepage;
                    this.editing = parseInt(settings.editing, 10);

                    this.waitel = Y.Node.create('<div></div>');
                    this.waitel.addClass('pagewait').addClass('hidden');
                    Y.one('#pdfholder').appendChild(this.waitel);
                },

                updatecomment: function (comment) {
                    var waitel, pageloadcount, status;
                    if (!this.editing) {
                        return;
                    }
                    if (comment.getData('id') === -1) {
                        // The comment does not have an ID from the server yet.
                        status = comment.getData('status');
                        if (status === 'saving' || status === 'needsupdate') {
                            // Waiting for a previous update to save on the server - note the request for an update
                            // and fire it off after this one has finished.
                            comment.setData('status', 'needsupdate');
                            return;
                        }
                        // First attempt to save this comment to the server - carry on.
                        comment.setData('status', 'saving');
                    }
                    waitel = Y.Node.create('<div class="wait"></div>');
                    comment.appendChild(waitel);
                    comment.setData('oldcolour', comment.getData('colour'));
                    pageloadcount = this.pageloadcount;
                    Y.io(this.url, {
                        timeout: resendtimeout,
                        on: {
                            success: function (id, resp) {
                                if (pageloadcount !== server.pageloadcount) { return; }
                                comment.all('.wait').remove(true);
                                try {
                                    resp = Y.JSON.parse(resp.responseText);
                                } catch (e) {
                                    comment.setData('status', ''); // Otherwise the new update won't get sent.
                                    showsendfailed(function () { server.updatecomment(comment); });
                                    return;
                                }
                                server.retrycount = 0;
                                if (resp.error === 0) {
                                    comment.setData('id', resp.id);
                                    if (comment.getData('status') === 'needsupdate') {
                                        comment.setData('status', 'saving');
                                        server.updatecomment(comment); // Now we have the ID, we have another update to send off.
                                    } else {
                                        comment.setData('status', 'saved');
                                    }
                                    updatefindcomments(parseInt(server.pageno, 10), resp.id, comment.getData('rawtext'));
                                } else {
                                    if (confirm(server_config.lang_errormessage + resp.error + '\n' + server_config.lang_okagain)) {
                                        server.updatecomment(comment);
                                    }
                                }
                            },
                            failure: function () {
                                if (pageloadcount !== server.pageloadcount) { return; }
                                comment.setData('status', ''); // Otherwise the new update won't get sent.
                                showsendfailed(function () { server.updatecomment(comment); });
                            }
                        },
                        data: {
                            action: 'update',
                            comment_position_x: comment.getStyle('left'),
                            comment_position_y: comment.getStyle('top'),
                            comment_width: comment.getStyle('width'),
                            comment_text: comment.getData('rawtext'),
                            comment_id: comment.getData('id'),
                            comment_colour: comment.getData('colour'),
                            id: this.id,
                            submissionid: this.submissionid,
                            pageno: this.pageno,
                            sesskey: this.sesskey
                        }
                    });
                },

                removecomment: function (cid) {
                    var pageloadcount;
                    if (!this.editing) {
                        return;
                    }
                    removefromfindcomments(cid);
                    pageloadcount = this.pageloadcount;
                    Y.io(this.url, {
                        on: {
                            success: function (id, resp) {
                                if (pageloadcount !== server.pageloadcount) { return; }
                                try {
                                    resp = Y.JSON.parse(resp.responseText);
                                } catch (e) {
                                    showsendfailed(function () { server.removecomment(cid); });
                                    return;
                                }
                                server.retrycount = 0;
                                if (resp.error !== 0) {
                                    if (confirm(server_config.lang_errormessage + resp.error + '\n' + server_config.lang_okagain)) {
                                        server.removecomment(cid);
                                    }
                                }
                            },
                            failure: function () {
                                if (pageloadcount !== server.pageloadcount) { return; }
                                showsendfailed(function () { server.removecomment(cid); });
                            }
                        },
                        data: {
                            action: 'delete',
                            commentid: cid,
                            id: this.id,
                            submissionid: this.submissionid,
                            pageno: this.pageno,
                            sesskey: this.sesskey
                        }
                    });
                },

                getcomments: function () {
                    this.waitel.removeClass('hidden');
                    var pageno, scrolltocommentid, pageloadcount;
                    pageno = this.pageno;
                    scrolltocommentid = this.scrolltocommentid;
                    pageloadcount = this.pageloadcount;
                    this.scrolltocommentid = 0;

                    Y.io(this.url, {
                        on: {
                            success: function (id, resp) {
                                if (pageloadcount !== server.pageloadcount) { return; }
                                server.waitel.addClass('hidden');
                                try {
                                    resp = Y.JSON.parse(resp.responseText);
                                } catch (e) {
                                    showsendfailed(function () { server.getcomments(); });
                                    return;
                                }
                                server.retrycount = 0;
                                if (resp.error === 0) {
                                    if (pageno === server.pageno) { // Make sure the page hasn't changed since we sent this request
                                        Y.Array.each(resp.comments, function (comment) {
                                            var cb;
                                            cb = makecommentbox(comment.position, comment.text, comment.colour);
                                            cb.setStyle('width', comment.width + 'px');
                                            cb.setData('id', comment.id);
                                        });

                                        // Get annotations at the same time
                                        Y.Array.each(allannotations, function (p) { p.remove(true); });
                                        allannotations.length = 0;
                                        Y.Array.each(resp.annotations, function (annotation) {
                                            var coords, points, i;
                                            if (annotation.type === 'freehand') {
                                                coords = [];
                                                points = annotation.path.split(',');
                                                for (i = 0; (i + 1) < points.length; i += 2) {
                                                    coords.push({x: parseInt(points[i], 10), y: parseInt(points[i + 1], 10)});
                                                }
                                            } else {
                                                coords = {
                                                    sx: parseInt(annotation.coords.startx, 10),
                                                    sy: parseInt(annotation.coords.starty, 10),
                                                    ex: parseInt(annotation.coords.endx, 10),
                                                    ey: parseInt(annotation.coords.endy, 10)
                                                };
                                            }
                                            makeline(coords, annotation.type, annotation.id, annotation.colour, annotation.path);
                                        });

                                        doscrolltocomment(scrolltocommentid);
                                    }
                                } else {
                                    if (confirm(server_config.lang_errormessage + resp.error + '\n' + server_config.lang_okagain)) {
                                        server.getcomments();
                                    }
                                }
                            },

                            failure: function () {
                                if (pageloadcount !== server.pageloadcount) { return; }
                                showsendfailed(function () {server.getcomments(); });
                                server.waitel.addClass('hidden');
                            }
                        },

                        data: {
                            action: 'getcomments',
                            id: this.id,
                            submissionid: this.submissionid,
                            pageno: this.pageno,
                            sesskey: this.sesskey
                        }
                    });
                },

                getquicklist: function () {
                    if (!this.editing) {
                        return;
                    }
                    Y.io(this.url, {
                        on: {
                            success: function (id, resp) {
                                try {
                                    resp = Y.JSON.parse(resp.responseText);
                                } catch (e) {
                                    showsendfailed(function () { server.getquicklist(); });
                                    return;
                                }
                                server.retrycount = 0;
                                if (resp.error === 0) {
                                    Y.Array.each(resp.quicklist, addtoquicklist);  // Assume contains: id, rawtext, colour, width
                                } else {
                                    if (confirm(server_config.lang_errormessage + resp.error + '\n' + server_config.lang_okagain)) {
                                        server.getquicklist();
                                    }
                                }
                            },

                            failure: function () {
                                showsendfailed(function () { server.getquicklist(); });
                            }
                        },

                        data: {
                            action: 'getquicklist',
                            id: this.id,
                            submissionid: this.submissionid, // This and pageno are not strictly needed, but are checked for on the server
                            pageno: this.pageno,
                            sesskey: this.sesskey
                        }
                    });
                },

                addtoquicklist: function (element) {
                    if (!this.editing) {
                        return;
                    }
                    Y.io(this.url, {
                        on: {
                            success: function (id, resp) {
                                try {
                                    resp = Y.JSON.parse(resp.responseText);
                                } catch (e) {
                                    showsendfailed(function () { server.addtoquicklist(element); });
                                    return;
                                }
                                server.retrycount = 0;
                                if (resp.error === 0) {
                                    addtoquicklist(resp.item);  // Assume contains: id, rawtext, colour, width
                                } else {
                                    if (confirm(server_config.lang_errormessage + resp.error + '\n' + server_config.lang_okagain)) {
                                        server.addtoquicklist(element);
                                    }
                                }
                            },

                            failure: function () {
                                showsendfailed(function () { server.addtoquicklist(element); });
                            }
                        },

                        data: {
                            action: 'addtoquicklist',
                            colour: element.getData('colour'),
                            text: element.getData('rawtext'),
                            width: parseInt(element.getStyle('width'), 10),
                            id: this.id,
                            submissionid: this.submissionid, // This and pageno are not strictly needed, but are checked for on the server
                            pageno: this.pageno,
                            sesskey: this.sesskey
                        }
                    });
                },

                removefromquicklist: function (itemid) {
                    if (!this.editing) {
                        return;
                    }
                    Y.io(this.url, {
                        on: {
                            success: function (id, resp) {
                                try {
                                    resp = Y.JSON.parse(resp.responseText);
                                } catch (e) {
                                    showsendfailed(function () { server.removefromquicklist(itemid); });
                                    return;
                                }
                                server.retrycount = 0;
                                if (resp.error === 0) {
                                    removefromquicklist(resp.itemid);
                                } else {
                                    if (confirm(server_config.lang_errormessage + resp.error + '\n' + server_config.lang_okagain)) {
                                        server.removefromquicklist(itemid);
                                    }
                                }
                            },

                            failure: function () {
                                showsendfailed(function () { server.removefromquicklist(itemid); });
                            }
                        },

                        data: {
                            action: 'removefromquicklist',
                            itemid: itemid,
                            id: this.id,
                            submissionid: this.submissionid, // This and pageno are not strictly needed, but are checked for on the server
                            pageno: this.pageno,
                            sesskey: this.sesskey
                        }
                    });
                },

                getimageurl: function (pageno, changenow) {
                    if (changenow) {
                        if ($defined(pagelist[pageno])) {
                            showpage(pageno);
                            pagesremaining += 1;
                            if (pagesremaining > 1) {
                                return; // Already requests pending, so no need to send any more
                            }
                        } else {
                            waitingforpage = pageno;
                            pagesremaining = pagestopreload; // Wanted a page that wasn't preloaded, so load a few more
                            Y.one('#pdfimg').set('src', server_config.blank_image);
                        }
                    }

                    var pagecount, startpage;

                    pagecount = parseInt(server_config.pagecount, 10);
                    if (pageno > pagecount) {
                        pageno = 1;
                    }
                    startpage = pageno;

                    // Find the next page that has not already been loaded
                    while ((pageno <= pagecount) && $defined(pagelist[pageno])) {
                        pageno += 1;
                    }
                    // Wrap around to the beginning again
                    if (pageno > pagecount) {
                        pageno = 1;
                        while ($defined(pagelist[pageno])) {
                            if (pageno === startpage) {
                                return; // All pages preloaded, so stop
                            }
                            pageno += 1;
                        }
                    }

                    Y.io(this.url, {
                        on: {
                            success: function (id, resp) {
                                try {
                                    resp = Y.JSON.parse(resp.responseText);
                                } catch (e) {
                                    showsendfailed(function () { server.getimageurl(pageno, false); });
                                    return;
                                }
                                server.retrycount = 0;
                                if (resp.error === 0) {
                                    pagesremaining -= 1;
                                    pagelist[pageno] = {};
                                    pagelist[pageno].url = resp.image.url;
                                    pagelist[pageno].width = resp.image.width;
                                    pagelist[pageno].height = resp.image.height;
                                    pagelist[pageno].image = new Image(resp.image.width, resp.image.height);
                                    pagelist[pageno].image.src = resp.image.url;
                                    if (waitingforpage === pageno) {
                                        showpage(pageno);
                                        waitingforpage = -1;
                                    }

                                    if (pagesremaining > 0) {
                                        var nextpage = parseInt(pageno, 10) + 1;
                                        server.getimageurl(nextpage, false);
                                    }

                                } else {
                                    if (confirm(server_config.lang_errormessage + resp.error + '\n' + server_config.lang_okagain)) {
                                        server.getimageurl(pageno, false);
                                    }
                                }
                            },

                            failure: function () {
                                showsendfailed(function () { server.getimageurl(pageno, false); });
                            }
                        },

                        data: {
                            action: 'getimageurl',
                            id: this.id,
                            submissionid: this.submissionid,
                            pageno: pageno,
                            sesskey: this.sesskey
                        }
                    });
                },

                addannotation: function (details, annotation) {
                    if (!this.editing) {
                        return;
                    }
                    this.waitel.removeClass('hidden');

                    if (!$defined(details.id)) {
                        details.id = -1;
                    }

                    var pageloadcount, requestdata;
                    pageloadcount = this.pageloadcount;

                    requestdata = {
                        action: 'addannotation',
                        annotation_colour: details.colour,
                        annotation_type: details.type,
                        annotation_id: details.id,
                        id: this.id,
                        submissionid: this.submissionid,
                        pageno: this.pageno,
                        sesskey: this.sesskey
                    };

                    if (details.type === 'freehand') {
                        requestdata.annotation_path = details.path;
                    } else {
                        requestdata.annotation_startx = details.coords.sx;
                        requestdata.annotation_starty = details.coords.sy;
                        requestdata.annotation_endx = details.coords.ex;
                        requestdata.annotation_endy = details.coords.ey;
                    }
                    if (details.type === 'stamp') {
                        requestdata.annotation_path = details.path;
                    }

                    Y.io(this.url, {
                        on: {
                            success: function (id, resp) {
                                if (pageloadcount !== server.pageloadcount) { return; }
                                try {
                                    resp = Y.JSON.parse(resp.responseText);
                                } catch (e) {
                                    showsendfailed(function () { server.addannotation(details, annotation); });
                                    return;
                                }
                                server.retrycount = 0;
                                server.waitel.addClass('hidden');
                                if (resp.error === 0) {
                                    if (details.id < 0) { // A new line
                                        annotation.setData('id', resp.id);
                                    }
                                } else {
                                    if (confirm(server_config.lang_errormessage + resp.error + '\n' + server_config.lang_okagain)) {
                                        server.addannotation(details, annotation);
                                    }
                                }
                            },

                            failure: function () {
                                if (pageloadcount !== server.pageloadcount) { return; }
                                server.waitel.addClass('hidden');
                                showsendfailed(function () { server.addannotation(details, annotation); });
                            }
                        },

                        data: requestdata
                    });
                },

                removeannotation: function (aid) {
                    if (!this.editing) {
                        return;
                    }
                    Y.io(this.url, {
                        on: {
                            success: function (id, resp) {
                                server.retrycount = 0;
                                try {
                                    resp = Y.JSON.parse(resp.responseText);
                                } catch (e) {
                                    showsendfailed(function () { server.removeannotation(aid); });
                                    return;
                                }
                                if (resp.error !== 0) {
                                    if (confirm(server_config.lang_errormessage + resp.error + '\n' + server_config.lang_okagain)) {
                                        server.removeannotation(aid);
                                    }
                                }
                            },
                            failure: function () {
                                showsendfailed(function () { server.removeannotation(aid); });
                            }
                        },
                        data: {
                            action: 'removeannotation',
                            annotationid: aid,
                            id: this.id,
                            submissionid: this.submissionid,
                            pageno: this.pageno,
                            sesskey: this.sesskey
                        }
                    });
                },

                scrolltocomment: function (commentid) {
                    this.scrolltocommentid = commentid;
                }
            };

            function addcomment(e) {
                if (!server.editing) {
                    return;
                }
                if (updatelastcomment()) {
                    return;
                }

                if (currentpaper) { // In the middle of drawing a line
                    return;
                }

                if (getcurrenttool() !== 'comment') {
                    return;
                }

                var modifier, imgpos, offs;
                modifier = (Y.UA.os === 'macintosh') ? e.altKey : e.ctrlKey;
                if (!modifier) {  // If control pressed, then drawing line
                    // Calculate the relative position of the comment
                    imgpos = Y.one('#pdfimg').getXY();
                    offs = {
                        x: e.pageX - imgpos[0],
                        y: e.pageY - imgpos[1]
                    };
                    currentcomment = makecommentbox(offs);
                }
            }

            function eraseline(e) {
                if (!server.editing) {
                    return false;
                }
                if (getcurrenttool() !== 'erase') {
                    return false;
                }

                var id, container, target, pos;
                target = e.currentTarget;
                id = target.getData('id');
                if (id) {
                    container = target.getData('container');
                    pos = Y.Array.indexOf(allannotations, container);
                    if (pos !== -1) {
                        allannotations.splice(pos, 1); // Remove from the 'allannotations' list.
                    }
                    container.remove(true);
                    server.removeannotation(id);
                }

                return true;
            }

            function keyboardnavigation(e) {
                if ($defined(currentcomment)) {
                    return; // No keyboard navigation when editing comments
                }

                if (e.keyCode === 78) { // n
                    gotonextpage();
                } else if (e.keyCode === 80) { // p
                    gotoprevpage();
                }
                if (server.editing) {
                    if (e.keyCode === 67) { // c
                        setcurrenttool('comment');
                    } else if (e.keyCode === 76) { // l
                        setcurrenttool('line');
                    } else if (e.keyCode === 82) { // r
                        setcurrenttool('rectangle');
                    } else if (e.keyCode === 79) { // o
                        setcurrenttool('oval');
                    } else if (e.keyCode === 70) { // f
                        setcurrenttool('freehand');
                    } else if (e.keyCode === 72) { // h
                        setcurrenttool('highlight');
                    } else if (e.keyCode === 83) { // s
                        setcurrenttool('stamp');
                    } else if (e.keyCode === 69) { // e
                        setcurrenttool('erase');
                    } else if (e.keyCode === 219) {  // { or [
                        if (e.shiftKey) {
                            prevlinecolour();
                        } else {
                            prevcommentcolour();
                        }
                    } else if (e.keyCode === 221) {  // } or ]
                        if (e.shiftKey) {
                            nextlinecolour();
                        } else {
                            nextcommentcolour();
                        }
                    }
                }
            }

            function doscrolltocomment(commentid) {
                commentid = parseInt(commentid, 10);
                if (commentid === 0) {
                    return;
                }
                if (lasthighlight) {
                    lasthighlight.removeClass('comment-highlight');
                    lasthighlight = null;
                }
                var comments = Y.one('#pdfholder').all('.comment');
                comments.each(function (comment) {
                    var dims, win, scroll, view, scrolltocoord;

                    if (parseInt(comment.getData('id'), 10) === commentid) {
                        comment.addClass('comment-highlight');
                        lasthighlight = comment;

                        dims = {
                            left: comment.getX(),
                            top: comment.getY(),
                            height: parseInt(comment.getComputedStyle('height'), 10),
                            width: parseInt(comment.getComputedStyle('width'), 10)
                        };
                        dims.right = dims.left + dims.width;
                        dims.bottom = dims.top + dims.height;

                        win = {
                            left: 0,
                            top: 0,
                            height: window.innerHeight || document.documentElement.clientHeight ||
                                document.getElementsByTagName('body')[0].clientHeigth,
                            width: window.innerWidth || document.documentElement.clientWidth ||
                                document.getElementsByTagName('body')[0].clientWidth
                        };
                        win.right = win.left + win.width;
                        win.bottom = win.top + win.height;
                        scroll = {
                            left: (window.pageXOffset || document.body.scrollLeft),
                            top: (window.pageYOffset || document.body.scrollTop)
                        };
                        view = win;
                        view.right += scroll.left;
                        view.bottom += scroll.top;
                        view.left += scroll.left;
                        view.top += scroll.top;

                        scrolltocoord = {left: scroll.left, top: scroll.top};

                        if (view.right < (dims.right + 30)) {
                            if ((dims.width + 40) < win.width) {
                                // Scroll right of comment onto the screen (if it will all fit)
                                scrolltocoord.left = dims.right + 30 - win.width;
                            } else {
                                // Just scroll the left of the comment onto the screen
                                scrolltocoord.left = dims.left - 10;
                            }
                        } else if (view.left > (dims.left - 10)) {
                            scrolltocoord.left = dims.left - 10;
                        }

                        if (view.bottom < (dims.bottom + 30)) {
                            if ((dims.height + 40) < win.height) {
                                // Scroll bottom of comment onto the screen (if it will all fit)
                                scrolltocoord.top = dims.bottom + 30 - win.height;
                            } else {
                                // Just scroll top of comment onto the screen
                                scrolltocoord.top = dims.top - 10;
                            }
                        }

                        window.scrollTo(scrolltocoord.left, scrolltocoord.top);
                    }
                });
            }

            function startjs() {
                server.initialize(server_config);

                var showPreviousMenu, colour, linecolour, stamp, tool, pageno, sel, selidx, selpage, btn, helppanel;

                // TODO davo - remove YUI2 buttons
                if (server.editing) {
                    if (document.getElementById('choosecolour')) {
                        colourmenu = new YH.widget.Button("choosecolour", {
                            type: "menu",
                            menu: "choosecolourmenu",
                            lazyloadmenu: false
                        });
                        colourmenu.on("selectedMenuItemChange", function (e) {
                            var menuitem, colour;
                            menuitem = e.newValue;
                            colour = (/choosecolour-([a-z]*)/i.exec(menuitem.element.className))[1];
                            this.set("label", '<img src="' + server_config.image_path + colour + '.gif" />');
                            this.set("value", colour);
                            changecolour();
                        });
                    }
                    if (document.getElementById('chooselinecolour')) {
                        linecolourmenu = new YH.widget.Button("chooselinecolour", {
                            type: "menu",
                            menu: "chooselinecolourmenu",
                            lazyloadmenu: false
                        });
                        linecolourmenu.on("selectedMenuItemChange", function (e) {
                            var menuitem, colour;
                            menuitem = e.newValue;
                            colour = (/choosecolour-([a-z]*)/i.exec(menuitem.element.className))[1];
                            this.set("label", '<img src="' + server_config.image_path + 'line' + colour + '.gif" />');
                            this.set("value", colour);
                            changelinecolour();
                        });
                    }
                    if (document.getElementById('choosestamp')) {
                        stampmenu = new YH.widget.Button("choosestamp", {
                            type: "menu",
                            menu: "choosestampmenu",
                            lazyloadmenu: false
                        });
                        stampmenu.on("selectedMenuItemChange", function (e) {
                            var menuitem, stamp;
                            menuitem = e.newValue;
                            stamp = (/choosestamp-([a-z]*)/i.exec(menuitem.element.className))[1];
                            this.set("label", '<img width="32" height="32" src="' + getstampimage(stamp) + '" />');
                            this.set("value", stamp);
                            changestamp();
                        });
                    }
                    if (document.getElementById('showpreviousbutton')) {
                        showPreviousMenu = new YH.widget.Button("showpreviousbutton", {
                            type: "menu",
                            menu: "showpreviousselect",
                            lazyloadmenu: false
                        });
                        showPreviousMenu.on("selectedMenuItemChange", function (e) {
                            var compareid, url;
                            compareid = e.newValue.value;
                            url = 'editcomment.php?id=' + server.id + '&submissionid=' + server.submissionid + '&pageno=' + server.pageno;
                            if (compareid > -1) {
                                url += '&topframe=1&showprevious=' + compareid;
                            }
                            top.location = url;
                        });
                    }
                    if (document.getElementById('savedraft')) {
                        btn = new YH.widget.Button("savedraft");
                    }
                    if (document.getElementById('generateresponse')) {
                        btn = new YH.widget.Button("generateresponse");
                    }
                    if (document.getElementById('choosetoolgroup')) {
                        choosedrawingtool = new YH.widget.ButtonGroup("choosetoolgroup");
                        choosedrawingtool.on("checkedButtonChange", function (e) {
                            var newtool = e.newValue.get("value");
                            newtool = newtool.substr(0, newtool.length - 4); // Strip off the 'icon' part
                            Y.Cookie.set('feedbackpdf_tool', newtool);
                            abortline();
                            updatelastcomment();
                        });
                    }
                }
                btn = new YH.widget.Button("downloadpdf");
                prevbutton = new YH.widget.Button("prevpage");
                prevbutton.on("click", gotoprevpage);
                nextbutton = new YH.widget.Button("nextpage");
                nextbutton.on("click", gotonextpage);
                Y.one('#selectpage').on('change', selectpage);
                Y.one('#selectpage2').on('change', selectpage2);
                Y.one('#prevpage2').on('click', gotoprevpage);
                Y.one('#nextpage2').on('click', gotonextpage);
                findcommentsmenu = new YH.widget.Button("findcommentsbutton", {
                    type: "menu",
                    menu: "findcommentsselect",
                    lazyloadmenu: false
                });
                findcommentsmenu.on("selectedMenuItemChange", function (e) {
                    var menuval, pageno, commentid;
                    menuval = e.newValue.value;
                    pageno = parseInt(menuval.split(':')[0], 10);
                    commentid = parseInt(menuval.split(':')[1], 10);
                    if (pageno > 0) {
                        if (parseInt(server.pageno, 10) === pageno) {
                            doscrolltocomment(commentid);
                        } else {
                            server.scrolltocomment(commentid);
                            gotopage(pageno);
                        }
                    }
                });

                server.getcomments();

                if (server.editing) {
                    Y.one('#pdfimg').on('click', addcomment);
                    Y.one('#pdfimg').on('mousedown', startline);
                    Y.one('#pdfimg')._node.ondragstart = function () { return false; }; // To stop ie trying to drag the image
                    colour = Y.Cookie.get('feedbackpdf_colour');
                    if (!$defined(colour)) {
                        colour = 'yellow';
                    }
                    setcurrentcolour(colour);
                    linecolour = Y.Cookie.get('feedbackpdf_linecolour');
                    if (!$defined(linecolour)) {
                        linecolour = 'red';
                    }
                    setcurrentlinecolour(linecolour);
                    stamp = Y.Cookie.get('feedbackpdf_stamp');
                    if (!$defined(stamp) || stamp === 'null') {
                        stamp = 'tick';
                    }
                    setcurrentstamp(stamp, false);
                    tool = Y.Cookie.get('feedbackpdf_tool');
                    if (!$defined(tool)) {
                        tool = 'comment';
                    }
                    setcurrenttool(tool);

                    helppanel = new Y.Panel({
                        bodyContent: Y.one('#annotationhelp_text').getHTML(),
                        headerContent: 'Help',
                        width: '90%',
                        zIndex: 300,
                        centered: false,
                        render: false,
                        x: 20,
                        y: 20,
                        modal: true
                    });

                    Y.one('#annotationhelp').on('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        helppanel.show();
                        helppanel.render();
                        return false;
                    });

                }

                // Start preloading pages if using js navigation method
                Y.one('document').on('keydown', keyboardnavigation);
                pagelist = [];
                pageno = parseInt(server.pageno, 10);
                // Little fix as Firefox remembers the selected option after a page refresh
                sel = Y.one('#selectpage');
                selpage = sel.get('value');
                if (parseInt(selpage, 10) !== pageno) {
                    gotopage(selpage);
                } else {
                    updatepagenavigation(pageno);
                    server.getimageurl(pageno + 1, false);
                }

                Y.one('window').on('unload', function (e) {
                    pageunloading = true;
                });
                Y.one('window').on('beforeunload', function (e) {
                    pageunloading = true;
                });
            }

            function context_quicklistnoitems() {
                if (!server.editing) {
                    return;
                }

                if (context_quicklist.quickcount === 0) {
                    var hasnoitems = false;
                    context_quicklist.menu.all('a').each(function (el) {
                        if (el.get('href').split('#')[1] === 'noitems') {
                            hasnoitems = true;
                        }
                    });
                    if (!hasnoitems) {
                        context_quicklist.addItem('noitems', server_config.lang_emptyquicklist + ' &#0133;', null, function () { alert(server_config.lang_emptyquicklist_instructions); });
                    }
                } else {
                    context_quicklist.removeItem('noitems');
                }
            }

            function addtoquicklist(item) {
                if (!server.editing) {
                    return;
                }
                var itemid, itemtext, itemfulltext;
                itemid = item.id;
                if (quicklist.hasOwnProperty(itemid)) {
                    return; // We'v already got this (probably an extra message from the server)..
                }

                itemtext = item.text.trim().replace('\n', '');
                itemfulltext = false;
                if (itemtext.length > 30) {
                    itemtext = itemtext.substring(0, 30) + '&#0133;';
                    itemfulltext = item.text.trim().replace('<', '&lt;').replace('>', '&gt;');
                }
                itemtext = itemtext.replace('<', '&lt;').replace('>', '&gt;');

                quicklist[itemid] = item;

                context_quicklist.addItem(itemid, itemtext, server_config.deleteicon, function (id, menu) {
                    var imgpos, pos, cb, style;
                    imgpos = Y.one('#pdfimg').getXY();
                    pos = {
                        x: parseInt(menu.menu.getStyle('left'), 10) - imgpos[0] - menu.options.offsets.x,
                        y: parseInt(menu.menu.getStyle('top'), 10) - imgpos[1] - menu.options.offsets.y
                    };
                    // Nasty hack to reposition the comment box in IE
                    if (Y.UA.ie) {
                        if (Y.UA.ie === 6 || Y.UA.ie === 7) {
                            pos.x += 40;
                            pos.y -= 20;
                        } else if (Y.UA.ie === 8) {
                            pos.y -= 15;
                        }
                    }
                    cb = makecommentbox(pos, quicklist[id].text, quicklist[id].colour);
                    cb.setStyle('width', quicklist[id].width + 'px');
                    server.updatecomment(cb);
                }, itemfulltext);

                context_quicklist.quickcount += 1;
                context_quicklistnoitems();
            }

            function removefromquicklist(itemid) {
                if (!server.editing) {
                    return;
                }
                context_quicklist.removeItem(itemid);
                context_quicklist.quickcount -= 1;
                context_quicklistnoitems();
            }

            function initcontextmenu() {
                if (!server.editing) {
                    return;
                }
                var menu, items, n;
                Y.one('#context-quicklist').appendTo('body');
                Y.one('#context-comment').appendTo('body');

                //create a context menu
                context_quicklist = new ContextMenu({
                    targets: null,
                    menu: '#context-quicklist',
                    actions: {
                        removeitem: function (itemid) {
                            server.removefromquicklist(itemid);
                        }
                    }
                });
                context_quicklist.addmenu(Y.one('#pdfimg'));
                context_quicklist.quickcount = 0;
                context_quicklistnoitems();
                quicklist = [];

                if (Y.UA.ie === 6 || Y.UA.ie === 7) {
                    // Hack to draw the separator line correctly in IE7 and below
                    menu = document.getElementById('context-comment');
                    items = menu.getElementsByTagName('li');
                    for (n = 0; n < items.length; n += 1) {
                        if (items[n].className === 'separator') {
                            items[n].className = 'separatorie7';
                        }
                    }
                }

                context_comment = new ContextMenu({
                    targets: null,
                    menu: '#context-comment',
                    actions: {
                        addtoquicklist: function (element) {
                            server.addtoquicklist(element);
                        },
                        red: function (element) { updatecommentcolour('red', element); },
                        yellow: function (element) { updatecommentcolour('yellow', element); },
                        green: function (element) { updatecommentcolour('green', element); },
                        blue: function (element) { updatecommentcolour('blue', element); },
                        white: function (element) { updatecommentcolour('white', element); },
                        clear: function (element) { updatecommentcolour('clear', element); },
                        deletecomment: function (element) {
                            var id = element.getData('id');
                            if (id !== -1) {
                                server.removecomment(id);
                            }
                            element.remove(true);
                        }
                    }
                });

                server.getquicklist();
            }

            function check_pageimage(pageno) {
                if (pageno !== parseInt(server.pageno, 10)) {
                    return; // Moved off the page in question
                }
                if (pagelist[pageno].image.complete) {
                    Y.one('#pdfimg').setAttribute('src', pagelist[pageno].url);
                } else {
                    setTimeout(function () { check_pageimage(pageno); }, 200);
                }
            }

            startjs();
            initcontextmenu();
        });
}
