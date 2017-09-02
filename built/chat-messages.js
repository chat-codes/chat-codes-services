"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("underscore");
const editor_state_tracker_1 = require("./editor-state-tracker");
const events_1 = require("events");
const showdown = require("showdown");
const difflib = require("difflib");
function tstamp(x) {
    if (typeof (x) === typeof (1)) {
        return x;
    }
    else {
        return x.getTimestamp();
    }
}
function before(a, b) {
    return tstamp(a) < tstamp(b);
}
function after(a, b) {
    return tstamp(a) > tstamp(b);
}
function beforeEQ(a, b) {
    return tstamp(a) <= tstamp(b);
}
function afterEQ(a, b) {
    return tstamp(a) >= tstamp(b);
}
function reverseArr(input) {
    var ret = new Array;
    for (var i = input.length - 1; i >= 0; i--) {
        ret.push(input[i]);
    }
    return ret;
}
class TextMessage {
    constructor(sender, timestamp, message, editorStateTracker) {
        this.sender = sender;
        this.timestamp = timestamp;
        this.message = message;
        this.converter = new showdown.Converter({ simplifiedAutoLink: true });
        this.fileLinkRegexp = new RegExp('^(.+):\s*L(\\d+)(\\s*,\\s*(\\d+))?(\s*-\s*L(\\d+)(\\s*,\\s*(\\d+))?)?$');
        const htmlBuilder = document.createElement('li');
        htmlBuilder.innerHTML = this.converter.makeHtml(this.message);
        _.each(htmlBuilder.querySelectorAll('a'), (a) => {
            const fileLinkInfo = this.matchFileLinkAttributes(a.getAttribute('href'));
            if (fileLinkInfo) {
                const { fileName, start, end } = fileLinkInfo;
                if (isNaN(start.column)) {
                    start.column = -1;
                }
                if (isNaN(end.row)) {
                    end.row = start.row;
                } // just one line
                if (isNaN(end.column)) {
                    end.column = -1;
                }
                const editorState = editorStateTracker.fuzzyMatch(fileName);
                const fileID = editorState ? editorState.getEditorID() : fileName;
                a.setAttribute('href', 'javascript:void(0)');
                a.setAttribute('class', 'line_ref');
                a.setAttribute('data-file', fileID);
                a.setAttribute('data-start', [start.row, start.column].join(','));
                a.setAttribute('data-end', [end.row, end.column].join(','));
            }
        });
        this.html = htmlBuilder.innerHTML;
    }
    getSender() { return this.sender; }
    ;
    getTimestamp() { return this.timestamp; }
    ;
    getMessage() { return this.message; }
    ;
    getHTML() { return this.html; }
    ;
    matchFileLinkAttributes(str) {
        const match = str.match(this.fileLinkRegexp);
        if (match) {
            return {
                fileName: match[1],
                start: {
                    row: parseInt(match[2]),
                    column: parseInt(match[4])
                },
                end: {
                    row: parseInt(match[6]),
                    column: parseInt(match[8])
                }
            };
        }
        else {
            return false;
        }
    }
    ;
}
exports.TextMessage = TextMessage;
class Group extends events_1.EventEmitter {
    constructor(items) {
        super();
        this.items = [];
        items.forEach((item) => {
            this.doAddItem(item);
        });
    }
    ;
    getItems() { return this.items; }
    getEarliestItem() { return _.first(this.getItems()); }
    getLatestItem() { return _.last(this.getItems()); }
    getEarliestTimestamp() { return this.getEarliestItem().getTimestamp(); }
    getLatestTimestamp() { return this.getLatestItem().getTimestamp(); }
    includesTimestamp(timestamp) {
        return afterEQ(timestamp, this.getEarliestTimestamp()) && beforeEQ(timestamp, this.getLatestTimestamp());
    }
    ;
    occuredBefore(item) {
        return before(this.getLatestTimestamp(), item);
    }
    ;
    occuredBeforeEQ(item) {
        return beforeEQ(this.getLatestTimestamp(), item);
    }
    ;
    occuredAfter(item) {
        return after(this.getLatestTimestamp(), item);
    }
    ;
    occuredAfterEQ(item) {
        return afterEQ(this.getLatestTimestamp(), item);
    }
    ;
    getInsertionIndex(timestamp) {
        const items = this.getItems();
        let i = items.length - 1;
        for (; i >= 0; i--) {
            if (before(this.items[i], timestamp)) {
                return i + 1;
            }
        }
        return i;
    }
    split(timestamp) {
        const index = this.getInsertionIndex(timestamp);
        const beforeIndex = this.constructNew(this.items.slice(0, index));
        const afterIndex = this.constructNew(this.items.slice(index));
        return [beforeIndex, afterIndex];
    }
    ;
    doAddItem(item) {
        const insertionIndex = this.getInsertionIndex(item.getTimestamp());
        this.items.splice(insertionIndex, 0, item);
        return {
            insertionIndex: insertionIndex,
            item: item
        };
    }
    ;
    addItem(titem) {
        this.emit('item-will-be-added', {
            group: this,
            item: titem
        });
        const { insertionIndex, item } = this.doAddItem(titem);
        this.emit('item-added', {
            group: this,
            item: titem,
            insertionIndex: insertionIndex
        });
        return insertionIndex;
    }
    ;
    compatibleWith(item) {
        return true;
    }
    ;
    constructNew(items) {
        return new Group(items);
    }
    ;
}
class EditGroup extends Group {
    getDiffSummary() {
        const textBefore = this.getTextBefore();
        const textAfter = this.getTextAfter();
        const diffs = [];
        for (let i = 0; i < textBefore.length; i++) {
            let tbEditorState = textBefore[i].editorState;
            for (let j = 0; j < textAfter.length; j++) {
                let taEditorState = textAfter[j].editorState;
                if (taEditorState === tbEditorState) {
                    const editorState = taEditorState;
                    const valueBefore = textBefore[i].value;
                    const valueAfter = textAfter[j].value;
                    let diff = difflib.unifiedDiff(valueBefore, valueAfter, { fromfile: editorState.getTitle(), tofile: editorState.getTitle() });
                    diff[0] = diff[0].trim();
                    diff[1] = diff[1].trim();
                    diff = diff.join('\n');
                    diffs.push({
                        editorState: editorState,
                        valueBefore: valueBefore,
                        valueAfter: valueBefore,
                        diff: diff
                    });
                    break;
                }
            }
        }
        return diffs;
    }
    ;
    getTextBefore() {
        const editorStates = [];
        const rv = [];
        this.getItems().forEach((d) => {
            const editorState = d.getEditorState();
            if (_.indexOf(editorStates, editorState) < 0) {
                editorStates.push(editorState);
                rv.push({
                    editorState: editorState,
                    value: editorState.getTextBeforeDelta(d, true)
                });
            }
        });
        return rv;
    }
    getTextAfter() {
        const editorStates = [];
        const rv = [];
        reverseArr(this.getItems()).forEach((d) => {
            const editorState = d.getEditorState();
            if (_.indexOf(editorStates, editorState) < 0) {
                editorStates.push(editorState);
                rv.push({
                    editorState: editorState,
                    value: editorState.getTextAfterDelta(d, true)
                });
            }
        });
        return rv;
    }
    getEditorStates() {
        const editorStates = this.getItems().map(delta => delta.getEditorState());
        return _.unique(editorStates);
    }
    getAuthors() {
        const authors = this.getItems().map(delta => delta.getAuthor());
        return _.unique(authors);
    }
    compatibleWith(item) {
        return item instanceof editor_state_tracker_1.EditDelta;
    }
    ;
    constructNew(items) {
        return new EditGroup(items);
    }
    ;
}
exports.EditGroup = EditGroup;
/*
 * MessageGroup represents a group of messages that were sent by the same user *around*
 * the same time with no other users interrupting.
 */
class TextMessageGroup extends Group {
    getSender() { return this.getEarliestItem().getSender(); }
    compatibleWith(item) {
        return item instanceof TextMessage && item.getSender() === this.getSender();
    }
    ;
    constructNew(items) {
        return new TextMessageGroup(items);
    }
    ;
}
exports.TextMessageGroup = TextMessageGroup;
;
/*
 * A class to keep track of all of the messages in a conversation (where messages are grouped).
 */
class MessageGroups extends events_1.EventEmitter {
    constructor(chatUserList, editorStateTracker) {
        super();
        this.chatUserList = chatUserList;
        this.editorStateTracker = editorStateTracker;
        this.messageGroupingTimeThreshold = 5 * 60 * 1000; // The delay between when messages should be in separate groups (5 minutes)
        this.messageGroups = [];
        this.messages = [];
    }
    ;
    getMessageHistory() {
        return this.messages;
    }
    typeMatches(item, group) {
        return (group instanceof EditGroup && item instanceof editor_state_tracker_1.EditDelta) ||
            (group instanceof TextMessageGroup && item instanceof TextMessage);
    }
    addItem(item) {
        const itemTimestamp = item.getTimestamp();
        let insertedIntoExistingGroup = false;
        let i = this.messageGroups.length - 1;
        for (; i >= 0; i--) {
            const messageGroup = this.messageGroups[i];
            if (messageGroup.includesTimestamp(itemTimestamp)) {
                if (messageGroup.compatibleWith(item)) {
                    messageGroup.addItem(item);
                    insertedIntoExistingGroup = true;
                    break;
                }
                else {
                    this.emit('group-will-be-removed', {
                        messageGroup: messageGroup,
                        insertionIndex: i
                    });
                    this.messageGroups.splice(i, 1);
                    this.emit('group-removed', {
                        messageGroup: messageGroup,
                        insertionIndex: i
                    });
                    const splitGroup = messageGroup.split(itemTimestamp);
                    splitGroup.forEach((mg, j) => {
                        this.addGroup(mg, i + j);
                    });
                    i += splitGroup.length; // on the next loop, will be at the later split
                    continue;
                }
            }
            else if (messageGroup.occuredBefore(itemTimestamp)) {
                if (messageGroup.compatibleWith(item) && (itemTimestamp <= messageGroup.getEarliestTimestamp() + this.messageGroupingTimeThreshold)) {
                    messageGroup.addItem(item);
                    insertedIntoExistingGroup = true;
                }
                break;
            }
        }
        if (!insertedIntoExistingGroup) {
            const insertionIndex = i + 1;
            let group;
            if (item instanceof TextMessage) {
                group = new TextMessageGroup([item]);
            }
            else {
                group = new EditGroup([item]);
            }
            this.addGroup(group, insertionIndex);
        }
    }
    addGroup(group, insertionIndex) {
        this.emit('group-will-be-added', {
            messageGroup: group,
            insertionIndex: insertionIndex
        });
        this.messageGroups.splice(insertionIndex, 0, group);
        this.emit('group-added', {
            messageGroup: group,
            insertionIndex: insertionIndex
        });
    }
    addTextMessage(data) {
        this.messages.push(data);
        const sender = this.chatUserList.getUser(data.uid);
        const message = new TextMessage(sender, data.timestamp, data.message, this.editorStateTracker);
        return this.addItem(message);
    }
    ;
    addDelta(delta) {
        if (delta instanceof editor_state_tracker_1.EditDelta) {
            this.addItem(delta);
        }
    }
    ;
    getMessageGroups() { return this.messageGroups; }
    /**
     * Returns true if there are no messages and false otherwise
     * @return {boolean} If there are no messages
     */
    isEmpty() {
        return this.messageGroups.length === 0;
    }
}
exports.MessageGroups = MessageGroups;
//# sourceMappingURL=chat-messages.js.map