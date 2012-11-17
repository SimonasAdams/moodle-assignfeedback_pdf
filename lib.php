<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Library functions for the PDF feedback assignment plugin
 *
 * @package   assignfeedback_pdf
 * @copyright 2012 Davo Smith
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

define('ASSIGNFEEDBACK_PDF_FA_IMAGE', 'feedback_pdf_image'); // Images generated from each page of the PDF
define('ASSIGNFEEDBACK_PDF_FA_RESPONSE', 'feedback_pdf_response'); // Response generated once annotation is complete

define('ASSIGNFEEDBACK_PDF_FILENAME', 'response.pdf');

function assignfeedback_pdf_pluginfile($course, $cm, context $context, $filearea, $args, $forcedownload) {
    global $DB, $USER, $CFG;

    if ($context->contextlevel != CONTEXT_MODULE) {
        return false;
    }

    $submissionid = array_shift($args);
    $submission = $DB->get_record('assign_submission', array('id' => $submissionid));

    if ($submission->assignment != $cm->instance) {
        return false; // Submission does not belong to this assignment.
    }

    if ($USER->id == $submission->userid) {
        // Own submission - check permission to submit.
        if (!has_capability('mod/assign:submit', $context)) {
            return false;
        }
    } else {
        // Another user's submission - check permission to grade.
        if (!has_capability('mod/assign:grade', $context)) {
            return false;
        }
    }

    require_once($CFG->dirroot.'/mod/assign/locallib.php');
    $filename = array_pop($args);
    $filepath = '/';
    if ($filearea == ASSIGNFEEDBACK_PDF_FA_IMAGE) {
        if ($submission->status != ASSIGN_SUBMISSION_STATUS_SUBMITTED) {
            return false; // Not submitted for marking.
        }
        if (empty($args)) {
            $filepath = '/';
        } else {
            $filepath = '/'.implode('/', $args).'/';
        }
    } else if ($filearea == ASSIGNFEEDBACK_PDF_FA_RESPONSE) {
        if ($filename != ASSIGNFEEDBACK_PDF_FILENAME || !empty($args)) {
            return false; // Check filename and path (empty)
        }
        if ($submission->status != ASSIGN_SUBMISSION_STATUS_SUBMITTED) {
            return false; // Not submitted for marking.
        }
    } else {
        return false;
    }

    $fs = get_file_storage();
    $file = $fs->get_file($context->id, 'assignfeedback_pdf', $filearea, $submission->id, $filepath, $filename);
    if ($file) {
        send_stored_file($file, 86400, 0, $forcedownload);
    }

    return false;
}