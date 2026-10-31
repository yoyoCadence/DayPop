// Generated from src/reminders/edgeCore.ts by scripts/generate-reminder-core.mjs. Do not edit.
/* Bundled rrule 2.8.1 notices:
rrule.js: Library for working with recurrence rules for calendar dates.
=======================================================================

Copyright 2010, Jakub Roztocil <jakub@roztocil.name> and Lars Schöning

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

    1. Redistributions of source code must retain the above copyright notice,
       this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

    3. Neither the name of The author nor the names of its contributors may
       be used to endorse or promote products derived from this software
       without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE AUTHOR AND CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.



./rrule.js and ./test/tests.js is based on python-dateutil. LICENCE:

python-dateutil - Extensions to the standard Python datetime module.
====================================================================

Copyright (c) 2003-2011 - Gustavo Niemeyer <gustavo@niemeyer.net>
Copyright (c) 2012 - Tomi Pieviläinen <tomi.pievilainen@iki.fi>

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.
    * Neither the name of the copyright holder nor the names of its
      contributors may be used to endorse or promote products derived from
      this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/
//#region src/domain/eventOccurrenceKey.ts
var TIMED_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
/** Compare instants, not their transport encoding; never rewrite stored values. */
function eventOccurrenceKey(occurrence) {
	if (occurrence.kind === "all-day") return `all-day:${occurrence.date}`;
	const parts = TIMED_INSTANT.exec(occurrence.startsAt);
	if (!parts) throw new RangeError("invalid timed occurrence instant");
	const seconds = /* @__PURE__ */ new Date(`${parts[1]}${parts[3]}`);
	if (!Number.isFinite(seconds.getTime())) throw new RangeError("invalid timed occurrence instant");
	const fraction = (parts[2] ?? "").replace(/0+$/, "").padEnd(3, "0");
	return `timed:${seconds.toISOString().replace(/\.000Z$/, "")}.${fraction}Z`;
}
//#endregion
//#region node_modules/rrule/dist/esm/weekday.js
var ALL_WEEKDAYS = [
	"MO",
	"TU",
	"WE",
	"TH",
	"FR",
	"SA",
	"SU"
];
var Weekday = function() {
	function Weekday(weekday, n) {
		if (n === 0) throw new Error("Can't create weekday with n == 0");
		this.weekday = weekday;
		this.n = n;
	}
	Weekday.fromStr = function(str) {
		return new Weekday(ALL_WEEKDAYS.indexOf(str));
	};
	Weekday.prototype.nth = function(n) {
		return this.n === n ? this : new Weekday(this.weekday, n);
	};
	Weekday.prototype.equals = function(other) {
		return this.weekday === other.weekday && this.n === other.n;
	};
	Weekday.prototype.toString = function() {
		var s = ALL_WEEKDAYS[this.weekday];
		if (this.n) s = (this.n > 0 ? "+" : "") + String(this.n) + s;
		return s;
	};
	Weekday.prototype.getJsWeekday = function() {
		return this.weekday === 6 ? 0 : this.weekday + 1;
	};
	return Weekday;
}();
//#endregion
//#region node_modules/rrule/dist/esm/helpers.js
var isPresent = function(value) {
	return value !== null && value !== void 0;
};
var isNumber = function(value) {
	return typeof value === "number";
};
var isWeekdayStr = function(value) {
	return typeof value === "string" && ALL_WEEKDAYS.includes(value);
};
var isArray = Array.isArray;
/**
* Simplified version of python's range()
*/
var range = function(start, end) {
	if (end === void 0) end = start;
	if (arguments.length === 1) {
		end = start;
		start = 0;
	}
	var rang = [];
	for (var i = start; i < end; i++) rang.push(i);
	return rang;
};
var repeat = function(value, times) {
	var i = 0;
	var array = [];
	if (isArray(value)) for (; i < times; i++) array[i] = [].concat(value);
	else for (; i < times; i++) array[i] = value;
	return array;
};
var toArray = function(item) {
	if (isArray(item)) return item;
	return [item];
};
function padStart(item, targetLength, padString) {
	if (padString === void 0) padString = " ";
	var str = String(item);
	targetLength = targetLength >> 0;
	if (str.length > targetLength) return String(str);
	targetLength = targetLength - str.length;
	if (targetLength > padString.length) padString += repeat(padString, targetLength / padString.length);
	return padString.slice(0, targetLength) + String(str);
}
/**
* Python like split
*/
var split = function(str, sep, num) {
	var splits = str.split(sep);
	return num ? splits.slice(0, num).concat([splits.slice(num).join(sep)]) : splits;
};
/**
* closure/goog/math/math.js:modulo
* Copyright 2006 The Closure Library Authors.
* The % operator in JavaScript returns the remainder of a / b, but differs from
* some other languages in that the result will have the same sign as the
* dividend. For example, -1 % 8 == -1, whereas in some other languages
* (such as Python) the result would be 7. This function emulates the more
* correct modulo behavior, which is useful for certain applications such as
* calculating an offset index in a circular list.
*
* @param {number} a The dividend.
* @param {number} b The divisor.
* @return {number} a % b where the result is between 0 and b (either 0 <= x < b
* or b < x <= 0, depending on the sign of b).
*/
var pymod = function(a, b) {
	var r = a % b;
	return r * b < 0 ? r + b : r;
};
/**
* @see: <http://docs.python.org/library/functions.html#divmod>
*/
var divmod = function(a, b) {
	return {
		div: Math.floor(a / b),
		mod: pymod(a, b)
	};
};
var empty = function(obj) {
	return !isPresent(obj) || obj.length === 0;
};
/**
* Python-like boolean
*
* @return {Boolean} value of an object/primitive, taking into account
* the fact that in Python an empty list's/tuple's
* boolean value is False, whereas in JS it's true
*/
var notEmpty = function(obj) {
	return !empty(obj);
};
/**
* Return true if a value is in an array
*/
var includes = function(arr, val) {
	return notEmpty(arr) && arr.indexOf(val) !== -1;
};
//#endregion
//#region node_modules/rrule/dist/esm/dateutil.js
var datetime = function(y, m, d, h, i, s) {
	if (h === void 0) h = 0;
	if (i === void 0) i = 0;
	if (s === void 0) s = 0;
	return new Date(Date.UTC(y, m - 1, d, h, i, s));
};
/**
* General date-related utilities.
* Also handles several incompatibilities between JavaScript and Python
*
*/
var MONTH_DAYS = [
	31,
	28,
	31,
	30,
	31,
	30,
	31,
	31,
	30,
	31,
	30,
	31
];
/**
* Number of milliseconds of one day
*/
var ONE_DAY = 864e5;
/**
* Python uses 1-Jan-1 as the base for calculating ordinals but we don't
* want to confuse the JS engine with milliseconds > Number.MAX_NUMBER,
* therefore we use 1-Jan-1970 instead
*/
var ORDINAL_BASE = datetime(1970, 1, 1);
/**
* Python: MO-SU: 0 - 6
* JS: SU-SAT 0 - 6
*/
var PY_WEEKDAYS = [
	6,
	0,
	1,
	2,
	3,
	4,
	5
];
var isLeapYear = function(year) {
	return year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
};
var isDate = function(value) {
	return value instanceof Date;
};
var isValidDate = function(value) {
	return isDate(value) && !isNaN(value.getTime());
};
/**
* @see: <http://www.mcfedries.com/JavaScript/DaysBetween.asp>
*/
var daysBetween$1 = function(date1, date2) {
	var differencems = date1.getTime() - date2.getTime();
	return Math.round(differencems / ONE_DAY);
};
/**
* @see: <http://docs.python.org/library/datetime.html#datetime.date.toordinal>
*/
var toOrdinal = function(date) {
	return daysBetween$1(date, ORDINAL_BASE);
};
/**
* @see - <http://docs.python.org/library/datetime.html#datetime.date.fromordinal>
*/
var fromOrdinal = function(ordinal) {
	return new Date(ORDINAL_BASE.getTime() + ordinal * ONE_DAY);
};
var getMonthDays = function(date) {
	var month = date.getUTCMonth();
	return month === 1 && isLeapYear(date.getUTCFullYear()) ? 29 : MONTH_DAYS[month];
};
/**
* @return {Number} python-like weekday
*/
var getWeekday = function(date) {
	return PY_WEEKDAYS[date.getUTCDay()];
};
/**
* @see: <http://docs.python.org/library/calendar.html#calendar.monthrange>
*/
var monthRange = function(year, month) {
	var date = datetime(year, month + 1, 1);
	return [getWeekday(date), getMonthDays(date)];
};
/**
* @see: <http://docs.python.org/library/datetime.html#datetime.datetime.combine>
*/
var combine = function(date, time) {
	time = time || date;
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds()));
};
var clone = function(date) {
	return new Date(date.getTime());
};
var cloneDates = function(dates) {
	var clones = [];
	for (var i = 0; i < dates.length; i++) clones.push(clone(dates[i]));
	return clones;
};
/**
* Sorts an array of Date or Time objects
*/
var sort = function(dates) {
	dates.sort(function(a, b) {
		return a.getTime() - b.getTime();
	});
};
var timeToUntilString = function(time, utc) {
	if (utc === void 0) utc = true;
	var date = new Date(time);
	return [
		padStart(date.getUTCFullYear().toString(), 4, "0"),
		padStart(date.getUTCMonth() + 1, 2, "0"),
		padStart(date.getUTCDate(), 2, "0"),
		"T",
		padStart(date.getUTCHours(), 2, "0"),
		padStart(date.getUTCMinutes(), 2, "0"),
		padStart(date.getUTCSeconds(), 2, "0"),
		utc ? "Z" : ""
	].join("");
};
var untilStringToDate = function(until) {
	var bits = /^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(until);
	if (!bits) throw new Error("Invalid UNTIL value: ".concat(until));
	return new Date(Date.UTC(parseInt(bits[1], 10), parseInt(bits[2], 10) - 1, parseInt(bits[3], 10), parseInt(bits[5], 10) || 0, parseInt(bits[6], 10) || 0, parseInt(bits[7], 10) || 0));
};
var dateTZtoISO8601 = function(date, timeZone) {
	return date.toLocaleString("sv-SE", { timeZone }).replace(" ", "T") + "Z";
};
var dateInTimeZone = function(date, timeZone) {
	var localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	var dateInLocalTZ = new Date(dateTZtoISO8601(date, localTimeZone));
	var tzOffset = new Date(dateTZtoISO8601(date, timeZone !== null && timeZone !== void 0 ? timeZone : "UTC")).getTime() - dateInLocalTZ.getTime();
	return new Date(date.getTime() - tzOffset);
};
//#endregion
//#region node_modules/rrule/dist/esm/iterresult.js
/**
* This class helps us to emulate python's generators, sorta.
*/
var IterResult = function() {
	function IterResult(method, args) {
		this.minDate = null;
		this.maxDate = null;
		this._result = [];
		this.total = 0;
		this.method = method;
		this.args = args;
		if (method === "between") {
			this.maxDate = args.inc ? args.before : /* @__PURE__ */ new Date(args.before.getTime() - 1);
			this.minDate = args.inc ? args.after : new Date(args.after.getTime() + 1);
		} else if (method === "before") this.maxDate = args.inc ? args.dt : /* @__PURE__ */ new Date(args.dt.getTime() - 1);
		else if (method === "after") this.minDate = args.inc ? args.dt : new Date(args.dt.getTime() + 1);
	}
	/**
	* Possibly adds a date into the result.
	*
	* @param {Date} date - the date isn't necessarly added to the result
	* list (if it is too late/too early)
	* @return {Boolean} true if it makes sense to continue the iteration
	* false if we're done.
	*/
	IterResult.prototype.accept = function(date) {
		++this.total;
		var tooEarly = this.minDate && date < this.minDate;
		var tooLate = this.maxDate && date > this.maxDate;
		if (this.method === "between") {
			if (tooEarly) return true;
			if (tooLate) return false;
		} else if (this.method === "before") {
			if (tooLate) return false;
		} else if (this.method === "after") {
			if (tooEarly) return true;
			this.add(date);
			return false;
		}
		return this.add(date);
	};
	/**
	*
	* @param {Date} date that is part of the result.
	* @return {Boolean} whether we are interested in more values.
	*/
	IterResult.prototype.add = function(date) {
		this._result.push(date);
		return true;
	};
	/**
	* 'before' and 'after' return only one date, whereas 'all'
	* and 'between' an array.
	*
	* @return {Date,Array?}
	*/
	IterResult.prototype.getValue = function() {
		var res = this._result;
		switch (this.method) {
			case "all":
			case "between": return res;
			default: return res.length ? res[res.length - 1] : null;
		}
	};
	IterResult.prototype.clone = function() {
		return new IterResult(this.method, this.args);
	};
	return IterResult;
}();
//#endregion
//#region node_modules/tslib/tslib.es6.mjs
/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
var extendStatics = function(d, b) {
	extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d, b) {
		d.__proto__ = b;
	} || function(d, b) {
		for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
	};
	return extendStatics(d, b);
};
function __extends(d, b) {
	if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
	extendStatics(d, b);
	function __() {
		this.constructor = d;
	}
	d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}
var __assign = function() {
	__assign = Object.assign || function __assign(t) {
		for (var s, i = 1, n = arguments.length; i < n; i++) {
			s = arguments[i];
			for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
		}
		return t;
	};
	return __assign.apply(this, arguments);
};
function __spreadArray(to, from, pack) {
	if (pack || arguments.length === 2) {
		for (var i = 0, l = from.length, ar; i < l; i++) if (ar || !(i in from)) {
			if (!ar) ar = Array.prototype.slice.call(from, 0, i);
			ar[i] = from[i];
		}
	}
	return to.concat(ar || Array.prototype.slice.call(from));
}
//#endregion
//#region node_modules/rrule/dist/esm/callbackiterresult.js
/**
* IterResult subclass that calls a callback function on each add,
* and stops iterating when the callback returns false.
*/
var CallbackIterResult = function(_super) {
	__extends(CallbackIterResult, _super);
	function CallbackIterResult(method, args, iterator) {
		var _this = _super.call(this, method, args) || this;
		_this.iterator = iterator;
		return _this;
	}
	CallbackIterResult.prototype.add = function(date) {
		if (this.iterator(date, this._result.length)) {
			this._result.push(date);
			return true;
		}
		return false;
	};
	return CallbackIterResult;
}(IterResult);
//#endregion
//#region node_modules/rrule/dist/esm/nlp/i18n.js
var ENGLISH = {
	dayNames: [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday"
	],
	monthNames: [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December"
	],
	tokens: {
		SKIP: /^[ \r\n\t]+|^\.$/,
		number: /^[1-9][0-9]*/,
		numberAsText: /^(one|two|three)/i,
		every: /^every/i,
		"day(s)": /^days?/i,
		"weekday(s)": /^weekdays?/i,
		"week(s)": /^weeks?/i,
		"hour(s)": /^hours?/i,
		"minute(s)": /^minutes?/i,
		"month(s)": /^months?/i,
		"year(s)": /^years?/i,
		on: /^(on|in)/i,
		at: /^(at)/i,
		the: /^the/i,
		first: /^first/i,
		second: /^second/i,
		third: /^third/i,
		nth: /^([1-9][0-9]*)(\.|th|nd|rd|st)/i,
		last: /^last/i,
		for: /^for/i,
		"time(s)": /^times?/i,
		until: /^(un)?til/i,
		monday: /^mo(n(day)?)?/i,
		tuesday: /^tu(e(s(day)?)?)?/i,
		wednesday: /^we(d(n(esday)?)?)?/i,
		thursday: /^th(u(r(sday)?)?)?/i,
		friday: /^fr(i(day)?)?/i,
		saturday: /^sa(t(urday)?)?/i,
		sunday: /^su(n(day)?)?/i,
		january: /^jan(uary)?/i,
		february: /^feb(ruary)?/i,
		march: /^mar(ch)?/i,
		april: /^apr(il)?/i,
		may: /^may/i,
		june: /^june?/i,
		july: /^july?/i,
		august: /^aug(ust)?/i,
		september: /^sep(t(ember)?)?/i,
		october: /^oct(ober)?/i,
		november: /^nov(ember)?/i,
		december: /^dec(ember)?/i,
		comma: /^(,\s*|(and|or)\s*)+/i
	}
};
//#endregion
//#region node_modules/rrule/dist/esm/nlp/totext.js
/**
* Return true if a value is in an array
*/
var contains = function(arr, val) {
	return arr.indexOf(val) !== -1;
};
var defaultGetText = function(id) {
	return id.toString();
};
var defaultDateFormatter = function(year, month, day) {
	return "".concat(month, " ").concat(day, ", ").concat(year);
};
/**
*
* @param {RRule} rrule
* Optional:
* @param {Function} gettext function
* @param {Object} language definition
* @constructor
*/
var ToText = function() {
	function ToText(rrule, gettext, language, dateFormatter) {
		if (gettext === void 0) gettext = defaultGetText;
		if (language === void 0) language = ENGLISH;
		if (dateFormatter === void 0) dateFormatter = defaultDateFormatter;
		this.text = [];
		this.language = language || ENGLISH;
		this.gettext = gettext;
		this.dateFormatter = dateFormatter;
		this.rrule = rrule;
		this.options = rrule.options;
		this.origOptions = rrule.origOptions;
		if (this.origOptions.bymonthday) {
			var bymonthday = [].concat(this.options.bymonthday);
			var bynmonthday = [].concat(this.options.bynmonthday);
			bymonthday.sort(function(a, b) {
				return a - b;
			});
			bynmonthday.sort(function(a, b) {
				return b - a;
			});
			this.bymonthday = bymonthday.concat(bynmonthday);
			if (!this.bymonthday.length) this.bymonthday = null;
		}
		if (isPresent(this.origOptions.byweekday)) {
			var byweekday = !isArray(this.origOptions.byweekday) ? [this.origOptions.byweekday] : this.origOptions.byweekday;
			var days = String(byweekday);
			this.byweekday = {
				allWeeks: byweekday.filter(function(weekday) {
					return !weekday.n;
				}),
				someWeeks: byweekday.filter(function(weekday) {
					return Boolean(weekday.n);
				}),
				isWeekdays: days.indexOf("MO") !== -1 && days.indexOf("TU") !== -1 && days.indexOf("WE") !== -1 && days.indexOf("TH") !== -1 && days.indexOf("FR") !== -1 && days.indexOf("SA") === -1 && days.indexOf("SU") === -1,
				isEveryDay: days.indexOf("MO") !== -1 && days.indexOf("TU") !== -1 && days.indexOf("WE") !== -1 && days.indexOf("TH") !== -1 && days.indexOf("FR") !== -1 && days.indexOf("SA") !== -1 && days.indexOf("SU") !== -1
			};
			var sortWeekDays = function(a, b) {
				return a.weekday - b.weekday;
			};
			this.byweekday.allWeeks.sort(sortWeekDays);
			this.byweekday.someWeeks.sort(sortWeekDays);
			if (!this.byweekday.allWeeks.length) this.byweekday.allWeeks = null;
			if (!this.byweekday.someWeeks.length) this.byweekday.someWeeks = null;
		} else this.byweekday = null;
	}
	/**
	* Test whether the rrule can be fully converted to text.
	*
	* @param {RRule} rrule
	* @return {Boolean}
	*/
	ToText.isFullyConvertible = function(rrule) {
		var canConvert = true;
		if (!(rrule.options.freq in ToText.IMPLEMENTED)) return false;
		if (rrule.origOptions.until && rrule.origOptions.count) return false;
		for (var key in rrule.origOptions) {
			if (contains([
				"dtstart",
				"tzid",
				"wkst",
				"freq"
			], key)) return true;
			if (!contains(ToText.IMPLEMENTED[rrule.options.freq], key)) return false;
		}
		return canConvert;
	};
	ToText.prototype.isFullyConvertible = function() {
		return ToText.isFullyConvertible(this.rrule);
	};
	/**
	* Perform the conversion. Only some of the frequencies are supported.
	* If some of the rrule's options aren't supported, they'll
	* be omitted from the output an "(~ approximate)" will be appended.
	*
	* @return {*}
	*/
	ToText.prototype.toString = function() {
		var gettext = this.gettext;
		if (!(this.options.freq in ToText.IMPLEMENTED)) return gettext("RRule error: Unable to fully convert this rrule to text");
		this.text = [gettext("every")];
		this[RRule.FREQUENCIES[this.options.freq]]();
		if (this.options.until) {
			this.add(gettext("until"));
			var until = this.options.until;
			this.add(this.dateFormatter(until.getUTCFullYear(), this.language.monthNames[until.getUTCMonth()], until.getUTCDate()));
		} else if (this.options.count) this.add(gettext("for")).add(this.options.count.toString()).add(this.plural(this.options.count) ? gettext("times") : gettext("time"));
		if (!this.isFullyConvertible()) this.add(gettext("(~ approximate)"));
		return this.text.join("");
	};
	ToText.prototype.HOURLY = function() {
		var gettext = this.gettext;
		if (this.options.interval !== 1) this.add(this.options.interval.toString());
		this.add(this.plural(this.options.interval) ? gettext("hours") : gettext("hour"));
	};
	ToText.prototype.MINUTELY = function() {
		var gettext = this.gettext;
		if (this.options.interval !== 1) this.add(this.options.interval.toString());
		this.add(this.plural(this.options.interval) ? gettext("minutes") : gettext("minute"));
	};
	ToText.prototype.DAILY = function() {
		var gettext = this.gettext;
		if (this.options.interval !== 1) this.add(this.options.interval.toString());
		if (this.byweekday && this.byweekday.isWeekdays) this.add(this.plural(this.options.interval) ? gettext("weekdays") : gettext("weekday"));
		else this.add(this.plural(this.options.interval) ? gettext("days") : gettext("day"));
		if (this.origOptions.bymonth) {
			this.add(gettext("in"));
			this._bymonth();
		}
		if (this.bymonthday) this._bymonthday();
		else if (this.byweekday) this._byweekday();
		else if (this.origOptions.byhour) this._byhour();
	};
	ToText.prototype.WEEKLY = function() {
		var gettext = this.gettext;
		if (this.options.interval !== 1) this.add(this.options.interval.toString()).add(this.plural(this.options.interval) ? gettext("weeks") : gettext("week"));
		if (this.byweekday && this.byweekday.isWeekdays) if (this.options.interval === 1) this.add(this.plural(this.options.interval) ? gettext("weekdays") : gettext("weekday"));
		else this.add(gettext("on")).add(gettext("weekdays"));
		else if (this.byweekday && this.byweekday.isEveryDay) this.add(this.plural(this.options.interval) ? gettext("days") : gettext("day"));
		else {
			if (this.options.interval === 1) this.add(gettext("week"));
			if (this.origOptions.bymonth) {
				this.add(gettext("in"));
				this._bymonth();
			}
			if (this.bymonthday) this._bymonthday();
			else if (this.byweekday) this._byweekday();
			if (this.origOptions.byhour) this._byhour();
		}
	};
	ToText.prototype.MONTHLY = function() {
		var gettext = this.gettext;
		if (this.origOptions.bymonth) {
			if (this.options.interval !== 1) {
				this.add(this.options.interval.toString()).add(gettext("months"));
				if (this.plural(this.options.interval)) this.add(gettext("in"));
			}
			this._bymonth();
		} else {
			if (this.options.interval !== 1) this.add(this.options.interval.toString());
			this.add(this.plural(this.options.interval) ? gettext("months") : gettext("month"));
		}
		if (this.bymonthday) this._bymonthday();
		else if (this.byweekday && this.byweekday.isWeekdays) this.add(gettext("on")).add(gettext("weekdays"));
		else if (this.byweekday) this._byweekday();
	};
	ToText.prototype.YEARLY = function() {
		var gettext = this.gettext;
		if (this.origOptions.bymonth) {
			if (this.options.interval !== 1) {
				this.add(this.options.interval.toString());
				this.add(gettext("years"));
			}
			this._bymonth();
		} else {
			if (this.options.interval !== 1) this.add(this.options.interval.toString());
			this.add(this.plural(this.options.interval) ? gettext("years") : gettext("year"));
		}
		if (this.bymonthday) this._bymonthday();
		else if (this.byweekday) this._byweekday();
		if (this.options.byyearday) this.add(gettext("on the")).add(this.list(this.options.byyearday, this.nth, gettext("and"))).add(gettext("day"));
		if (this.options.byweekno) this.add(gettext("in")).add(this.plural(this.options.byweekno.length) ? gettext("weeks") : gettext("week")).add(this.list(this.options.byweekno, void 0, gettext("and")));
	};
	ToText.prototype._bymonthday = function() {
		var gettext = this.gettext;
		if (this.byweekday && this.byweekday.allWeeks) this.add(gettext("on")).add(this.list(this.byweekday.allWeeks, this.weekdaytext, gettext("or"))).add(gettext("the")).add(this.list(this.bymonthday, this.nth, gettext("or")));
		else this.add(gettext("on the")).add(this.list(this.bymonthday, this.nth, gettext("and")));
	};
	ToText.prototype._byweekday = function() {
		var gettext = this.gettext;
		if (this.byweekday.allWeeks && !this.byweekday.isWeekdays) this.add(gettext("on")).add(this.list(this.byweekday.allWeeks, this.weekdaytext));
		if (this.byweekday.someWeeks) {
			if (this.byweekday.allWeeks) this.add(gettext("and"));
			this.add(gettext("on the")).add(this.list(this.byweekday.someWeeks, this.weekdaytext, gettext("and")));
		}
	};
	ToText.prototype._byhour = function() {
		var gettext = this.gettext;
		this.add(gettext("at")).add(this.list(this.origOptions.byhour, void 0, gettext("and")));
	};
	ToText.prototype._bymonth = function() {
		this.add(this.list(this.options.bymonth, this.monthtext, this.gettext("and")));
	};
	ToText.prototype.nth = function(n) {
		n = parseInt(n.toString(), 10);
		var nth;
		var gettext = this.gettext;
		if (n === -1) return gettext("last");
		var npos = Math.abs(n);
		switch (npos) {
			case 1:
			case 21:
			case 31:
				nth = npos + gettext("st");
				break;
			case 2:
			case 22:
				nth = npos + gettext("nd");
				break;
			case 3:
			case 23:
				nth = npos + gettext("rd");
				break;
			default: nth = npos + gettext("th");
		}
		return n < 0 ? nth + " " + gettext("last") : nth;
	};
	ToText.prototype.monthtext = function(m) {
		return this.language.monthNames[m - 1];
	};
	ToText.prototype.weekdaytext = function(wday) {
		var weekday = isNumber(wday) ? (wday + 1) % 7 : wday.getJsWeekday();
		return (wday.n ? this.nth(wday.n) + " " : "") + this.language.dayNames[weekday];
	};
	ToText.prototype.plural = function(n) {
		return n % 100 !== 1;
	};
	ToText.prototype.add = function(s) {
		this.text.push(" ");
		this.text.push(s);
		return this;
	};
	ToText.prototype.list = function(arr, callback, finalDelim, delim) {
		var _this = this;
		if (delim === void 0) delim = ",";
		if (!isArray(arr)) arr = [arr];
		var delimJoin = function(array, delimiter, finalDelimiter) {
			var list = "";
			for (var i = 0; i < array.length; i++) {
				if (i !== 0) if (i === array.length - 1) list += " " + finalDelimiter + " ";
				else list += delimiter + " ";
				list += array[i];
			}
			return list;
		};
		callback = callback || function(o) {
			return o.toString();
		};
		var realCallback = function(arg) {
			return callback && callback.call(_this, arg);
		};
		if (finalDelim) return delimJoin(arr.map(realCallback), delim, finalDelim);
		else return arr.map(realCallback).join(delim + " ");
	};
	return ToText;
}();
//#endregion
//#region node_modules/rrule/dist/esm/nlp/parsetext.js
var Parser = function() {
	function Parser(rules) {
		this.done = true;
		this.rules = rules;
	}
	Parser.prototype.start = function(text) {
		this.text = text;
		this.done = false;
		return this.nextSymbol();
	};
	Parser.prototype.isDone = function() {
		return this.done && this.symbol === null;
	};
	Parser.prototype.nextSymbol = function() {
		var best;
		var bestSymbol;
		this.symbol = null;
		this.value = null;
		do {
			if (this.done) return false;
			var rule = void 0;
			best = null;
			for (var name_1 in this.rules) {
				rule = this.rules[name_1];
				var match = rule.exec(this.text);
				if (match) {
					if (best === null || match[0].length > best[0].length) {
						best = match;
						bestSymbol = name_1;
					}
				}
			}
			if (best != null) {
				this.text = this.text.substr(best[0].length);
				if (this.text === "") this.done = true;
			}
			if (best == null) {
				this.done = true;
				this.symbol = null;
				this.value = null;
				return;
			}
		} while (bestSymbol === "SKIP");
		this.symbol = bestSymbol;
		this.value = best;
		return true;
	};
	Parser.prototype.accept = function(name) {
		if (this.symbol === name) {
			if (this.value) {
				var v = this.value;
				this.nextSymbol();
				return v;
			}
			this.nextSymbol();
			return true;
		}
		return false;
	};
	Parser.prototype.acceptNumber = function() {
		return this.accept("number");
	};
	Parser.prototype.expect = function(name) {
		if (this.accept(name)) return true;
		throw new Error("expected " + name + " but found " + this.symbol);
	};
	return Parser;
}();
function parseText(text, language) {
	if (language === void 0) language = ENGLISH;
	var options = {};
	var ttr = new Parser(language.tokens);
	if (!ttr.start(text)) return null;
	S();
	return options;
	function S() {
		ttr.expect("every");
		var n = ttr.acceptNumber();
		if (n) options.interval = parseInt(n[0], 10);
		if (ttr.isDone()) throw new Error("Unexpected end");
		switch (ttr.symbol) {
			case "day(s)":
				options.freq = RRule.DAILY;
				if (ttr.nextSymbol()) {
					AT();
					F();
				}
				break;
			case "weekday(s)":
				options.freq = RRule.WEEKLY;
				options.byweekday = [
					RRule.MO,
					RRule.TU,
					RRule.WE,
					RRule.TH,
					RRule.FR
				];
				ttr.nextSymbol();
				AT();
				F();
				break;
			case "week(s)":
				options.freq = RRule.WEEKLY;
				if (ttr.nextSymbol()) {
					ON();
					AT();
					F();
				}
				break;
			case "hour(s)":
				options.freq = RRule.HOURLY;
				if (ttr.nextSymbol()) {
					ON();
					F();
				}
				break;
			case "minute(s)":
				options.freq = RRule.MINUTELY;
				if (ttr.nextSymbol()) {
					ON();
					F();
				}
				break;
			case "month(s)":
				options.freq = RRule.MONTHLY;
				if (ttr.nextSymbol()) {
					ON();
					F();
				}
				break;
			case "year(s)":
				options.freq = RRule.YEARLY;
				if (ttr.nextSymbol()) {
					ON();
					F();
				}
				break;
			case "monday":
			case "tuesday":
			case "wednesday":
			case "thursday":
			case "friday":
			case "saturday":
			case "sunday":
				options.freq = RRule.WEEKLY;
				options.byweekday = [RRule[ttr.symbol.substr(0, 2).toUpperCase()]];
				if (!ttr.nextSymbol()) return;
				while (ttr.accept("comma")) {
					if (ttr.isDone()) throw new Error("Unexpected end");
					var wkd = decodeWKD();
					if (!wkd) throw new Error("Unexpected symbol " + ttr.symbol + ", expected weekday");
					options.byweekday.push(RRule[wkd]);
					ttr.nextSymbol();
				}
				AT();
				MDAYs();
				F();
				break;
			case "january":
			case "february":
			case "march":
			case "april":
			case "may":
			case "june":
			case "july":
			case "august":
			case "september":
			case "october":
			case "november":
			case "december":
				options.freq = RRule.YEARLY;
				options.bymonth = [decodeM()];
				if (!ttr.nextSymbol()) return;
				while (ttr.accept("comma")) {
					if (ttr.isDone()) throw new Error("Unexpected end");
					var m = decodeM();
					if (!m) throw new Error("Unexpected symbol " + ttr.symbol + ", expected month");
					options.bymonth.push(m);
					ttr.nextSymbol();
				}
				ON();
				F();
				break;
			default: throw new Error("Unknown symbol");
		}
	}
	function ON() {
		var on = ttr.accept("on");
		var the = ttr.accept("the");
		if (!(on || the)) return;
		do {
			var nth = decodeNTH();
			var wkd = decodeWKD();
			var m = decodeM();
			if (nth) if (wkd) {
				ttr.nextSymbol();
				if (!options.byweekday) options.byweekday = [];
				options.byweekday.push(RRule[wkd].nth(nth));
			} else {
				if (!options.bymonthday) options.bymonthday = [];
				options.bymonthday.push(nth);
				ttr.accept("day(s)");
			}
			else if (wkd) {
				ttr.nextSymbol();
				if (!options.byweekday) options.byweekday = [];
				options.byweekday.push(RRule[wkd]);
			} else if (ttr.symbol === "weekday(s)") {
				ttr.nextSymbol();
				if (!options.byweekday) options.byweekday = [
					RRule.MO,
					RRule.TU,
					RRule.WE,
					RRule.TH,
					RRule.FR
				];
			} else if (ttr.symbol === "week(s)") {
				ttr.nextSymbol();
				var n = ttr.acceptNumber();
				if (!n) throw new Error("Unexpected symbol " + ttr.symbol + ", expected week number");
				options.byweekno = [parseInt(n[0], 10)];
				while (ttr.accept("comma")) {
					n = ttr.acceptNumber();
					if (!n) throw new Error("Unexpected symbol " + ttr.symbol + "; expected monthday");
					options.byweekno.push(parseInt(n[0], 10));
				}
			} else if (m) {
				ttr.nextSymbol();
				if (!options.bymonth) options.bymonth = [];
				options.bymonth.push(m);
			} else return;
		} while (ttr.accept("comma") || ttr.accept("the") || ttr.accept("on"));
	}
	function AT() {
		if (!ttr.accept("at")) return;
		do {
			var n = ttr.acceptNumber();
			if (!n) throw new Error("Unexpected symbol " + ttr.symbol + ", expected hour");
			options.byhour = [parseInt(n[0], 10)];
			while (ttr.accept("comma")) {
				n = ttr.acceptNumber();
				if (!n) throw new Error("Unexpected symbol " + ttr.symbol + "; expected hour");
				options.byhour.push(parseInt(n[0], 10));
			}
		} while (ttr.accept("comma") || ttr.accept("at"));
	}
	function decodeM() {
		switch (ttr.symbol) {
			case "january": return 1;
			case "february": return 2;
			case "march": return 3;
			case "april": return 4;
			case "may": return 5;
			case "june": return 6;
			case "july": return 7;
			case "august": return 8;
			case "september": return 9;
			case "october": return 10;
			case "november": return 11;
			case "december": return 12;
			default: return false;
		}
	}
	function decodeWKD() {
		switch (ttr.symbol) {
			case "monday":
			case "tuesday":
			case "wednesday":
			case "thursday":
			case "friday":
			case "saturday":
			case "sunday": return ttr.symbol.substr(0, 2).toUpperCase();
			default: return false;
		}
	}
	function decodeNTH() {
		switch (ttr.symbol) {
			case "last":
				ttr.nextSymbol();
				return -1;
			case "first":
				ttr.nextSymbol();
				return 1;
			case "second":
				ttr.nextSymbol();
				return ttr.accept("last") ? -2 : 2;
			case "third":
				ttr.nextSymbol();
				return ttr.accept("last") ? -3 : 3;
			case "nth":
				var v = parseInt(ttr.value[1], 10);
				if (v < -366 || v > 366) throw new Error("Nth out of range: " + v);
				ttr.nextSymbol();
				return ttr.accept("last") ? -v : v;
			default: return false;
		}
	}
	function MDAYs() {
		ttr.accept("on");
		ttr.accept("the");
		var nth = decodeNTH();
		if (!nth) return;
		options.bymonthday = [nth];
		ttr.nextSymbol();
		while (ttr.accept("comma")) {
			nth = decodeNTH();
			if (!nth) throw new Error("Unexpected symbol " + ttr.symbol + "; expected monthday");
			options.bymonthday.push(nth);
			ttr.nextSymbol();
		}
	}
	function F() {
		if (ttr.symbol === "until") {
			var date = Date.parse(ttr.text);
			if (!date) throw new Error("Cannot parse until date:" + ttr.text);
			options.until = new Date(date);
		} else if (ttr.accept("for")) {
			options.count = parseInt(ttr.value[0], 10);
			ttr.expect("number");
		}
	}
}
//#endregion
//#region node_modules/rrule/dist/esm/types.js
var Frequency;
(function(Frequency) {
	Frequency[Frequency["YEARLY"] = 0] = "YEARLY";
	Frequency[Frequency["MONTHLY"] = 1] = "MONTHLY";
	Frequency[Frequency["WEEKLY"] = 2] = "WEEKLY";
	Frequency[Frequency["DAILY"] = 3] = "DAILY";
	Frequency[Frequency["HOURLY"] = 4] = "HOURLY";
	Frequency[Frequency["MINUTELY"] = 5] = "MINUTELY";
	Frequency[Frequency["SECONDLY"] = 6] = "SECONDLY";
})(Frequency || (Frequency = {}));
function freqIsDailyOrGreater(freq) {
	return freq < Frequency.HOURLY;
}
//#endregion
//#region node_modules/rrule/dist/esm/nlp/index.js
/**
*
* Implementation of RRule.fromText() and RRule::toText().
*
*
* On the client side, this file needs to be included
* when those functions are used.
*
*/
/**
* Will be able to convert some of the below described rules from
* text format to a rule object.
*
*
* RULES
*
* Every ([n])
* day(s)
* | [weekday], ..., (and) [weekday]
* | weekday(s)
* | week(s)
* | month(s)
* | [month], ..., (and) [month]
* | year(s)
*
*
* Plus 0, 1, or multiple of these:
*
* on [weekday], ..., (or) [weekday] the [monthday], [monthday], ... (or) [monthday]
*
* on [weekday], ..., (and) [weekday]
*
* on the [monthday], [monthday], ... (and) [monthday] (day of the month)
*
* on the [nth-weekday], ..., (and) [nth-weekday] (of the month/year)
*
*
* Plus 0 or 1 of these:
*
* for [n] time(s)
*
* until [date]
*
* Plus (.)
*
*
* Definitely no supported for parsing:
*
* (for year):
* in week(s) [n], ..., (and) [n]
*
* on the [yearday], ..., (and) [n] day of the year
* on day [yearday], ..., (and) [n]
*
*
* NON-TERMINALS
*
* [n]: 1, 2 ..., one, two, three ..
* [month]: January, February, March, April, May, ... December
* [weekday]: Monday, ... Sunday
* [nth-weekday]: first [weekday], 2nd [weekday], ... last [weekday], ...
* [monthday]: first, 1., 2., 1st, 2nd, second, ... 31st, last day, 2nd last day, ..
* [date]:
* - [month] (0-31(,) ([year])),
* - (the) 0-31.(1-12.([year])),
* - (the) 0-31/(1-12/([year])),
* - [weekday]
*
* [year]: 0000, 0001, ... 01, 02, ..
*
* Definitely not supported for parsing:
*
* [yearday]: first, 1., 2., 1st, 2nd, second, ... 366th, last day, 2nd last day, ..
*
* @param {String} text
* @return {Object, Boolean} the rule, or null.
*/
var fromText = function(text, language) {
	if (language === void 0) language = ENGLISH;
	return new RRule(parseText(text, language) || void 0);
};
var common = [
	"count",
	"until",
	"interval",
	"byweekday",
	"bymonthday",
	"bymonth"
];
ToText.IMPLEMENTED = [];
ToText.IMPLEMENTED[Frequency.HOURLY] = common;
ToText.IMPLEMENTED[Frequency.MINUTELY] = common;
ToText.IMPLEMENTED[Frequency.DAILY] = ["byhour"].concat(common);
ToText.IMPLEMENTED[Frequency.WEEKLY] = common;
ToText.IMPLEMENTED[Frequency.MONTHLY] = common;
ToText.IMPLEMENTED[Frequency.YEARLY] = ["byweekno", "byyearday"].concat(common);
var toText = function(rrule, gettext, language, dateFormatter) {
	return new ToText(rrule, gettext, language, dateFormatter).toString();
};
var isFullyConvertible = ToText.isFullyConvertible;
//#endregion
//#region node_modules/rrule/dist/esm/datetime.js
var Time = function() {
	function Time(hour, minute, second, millisecond) {
		this.hour = hour;
		this.minute = minute;
		this.second = second;
		this.millisecond = millisecond || 0;
	}
	Time.prototype.getHours = function() {
		return this.hour;
	};
	Time.prototype.getMinutes = function() {
		return this.minute;
	};
	Time.prototype.getSeconds = function() {
		return this.second;
	};
	Time.prototype.getMilliseconds = function() {
		return this.millisecond;
	};
	Time.prototype.getTime = function() {
		return (this.hour * 60 * 60 + this.minute * 60 + this.second) * 1e3 + this.millisecond;
	};
	return Time;
}();
var DateTime = function(_super) {
	__extends(DateTime, _super);
	function DateTime(year, month, day, hour, minute, second, millisecond) {
		var _this = _super.call(this, hour, minute, second, millisecond) || this;
		_this.year = year;
		_this.month = month;
		_this.day = day;
		return _this;
	}
	DateTime.fromDate = function(date) {
		return new this(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.valueOf() % 1e3);
	};
	DateTime.prototype.getWeekday = function() {
		return getWeekday(new Date(this.getTime()));
	};
	DateTime.prototype.getTime = function() {
		return new Date(Date.UTC(this.year, this.month - 1, this.day, this.hour, this.minute, this.second, this.millisecond)).getTime();
	};
	DateTime.prototype.getDay = function() {
		return this.day;
	};
	DateTime.prototype.getMonth = function() {
		return this.month;
	};
	DateTime.prototype.getYear = function() {
		return this.year;
	};
	DateTime.prototype.addYears = function(years) {
		this.year += years;
	};
	DateTime.prototype.addMonths = function(months) {
		this.month += months;
		if (this.month > 12) {
			var yearDiv = Math.floor(this.month / 12);
			var monthMod = pymod(this.month, 12);
			this.month = monthMod;
			this.year += yearDiv;
			if (this.month === 0) {
				this.month = 12;
				--this.year;
			}
		}
	};
	DateTime.prototype.addWeekly = function(days, wkst) {
		if (wkst > this.getWeekday()) this.day += -(this.getWeekday() + 1 + (6 - wkst)) + days * 7;
		else this.day += -(this.getWeekday() - wkst) + days * 7;
		this.fixDay();
	};
	DateTime.prototype.addDaily = function(days) {
		this.day += days;
		this.fixDay();
	};
	DateTime.prototype.addHours = function(hours, filtered, byhour) {
		if (filtered) this.hour += Math.floor((23 - this.hour) / hours) * hours;
		for (;;) {
			this.hour += hours;
			var _a = divmod(this.hour, 24), dayDiv = _a.div, hourMod = _a.mod;
			if (dayDiv) {
				this.hour = hourMod;
				this.addDaily(dayDiv);
			}
			if (empty(byhour) || includes(byhour, this.hour)) break;
		}
	};
	DateTime.prototype.addMinutes = function(minutes, filtered, byhour, byminute) {
		if (filtered) this.minute += Math.floor((1439 - (this.hour * 60 + this.minute)) / minutes) * minutes;
		for (;;) {
			this.minute += minutes;
			var _a = divmod(this.minute, 60), hourDiv = _a.div, minuteMod = _a.mod;
			if (hourDiv) {
				this.minute = minuteMod;
				this.addHours(hourDiv, false, byhour);
			}
			if ((empty(byhour) || includes(byhour, this.hour)) && (empty(byminute) || includes(byminute, this.minute))) break;
		}
	};
	DateTime.prototype.addSeconds = function(seconds, filtered, byhour, byminute, bysecond) {
		if (filtered) this.second += Math.floor((86399 - (this.hour * 3600 + this.minute * 60 + this.second)) / seconds) * seconds;
		for (;;) {
			this.second += seconds;
			var _a = divmod(this.second, 60), minuteDiv = _a.div, secondMod = _a.mod;
			if (minuteDiv) {
				this.second = secondMod;
				this.addMinutes(minuteDiv, false, byhour, byminute);
			}
			if ((empty(byhour) || includes(byhour, this.hour)) && (empty(byminute) || includes(byminute, this.minute)) && (empty(bysecond) || includes(bysecond, this.second))) break;
		}
	};
	DateTime.prototype.fixDay = function() {
		if (this.day <= 28) return;
		var daysinmonth = monthRange(this.year, this.month - 1)[1];
		if (this.day <= daysinmonth) return;
		while (this.day > daysinmonth) {
			this.day -= daysinmonth;
			++this.month;
			if (this.month === 13) {
				this.month = 1;
				++this.year;
				if (this.year > 9999) return;
			}
			daysinmonth = monthRange(this.year, this.month - 1)[1];
		}
	};
	DateTime.prototype.add = function(options, filtered) {
		var freq = options.freq, interval = options.interval, wkst = options.wkst, byhour = options.byhour, byminute = options.byminute, bysecond = options.bysecond;
		switch (freq) {
			case Frequency.YEARLY: return this.addYears(interval);
			case Frequency.MONTHLY: return this.addMonths(interval);
			case Frequency.WEEKLY: return this.addWeekly(interval, wkst);
			case Frequency.DAILY: return this.addDaily(interval);
			case Frequency.HOURLY: return this.addHours(interval, filtered, byhour);
			case Frequency.MINUTELY: return this.addMinutes(interval, filtered, byhour, byminute);
			case Frequency.SECONDLY: return this.addSeconds(interval, filtered, byhour, byminute, bysecond);
		}
	};
	return DateTime;
}(Time);
//#endregion
//#region node_modules/rrule/dist/esm/parseoptions.js
function initializeOptions$1(options) {
	var invalid = [];
	var keys = Object.keys(options);
	for (var _i = 0, keys_1 = keys; _i < keys_1.length; _i++) {
		var key = keys_1[_i];
		if (!includes(defaultKeys, key)) invalid.push(key);
		if (isDate(options[key]) && !isValidDate(options[key])) invalid.push(key);
	}
	if (invalid.length) throw new Error("Invalid options: " + invalid.join(", "));
	return __assign({}, options);
}
function parseOptions(options) {
	var opts = __assign(__assign({}, DEFAULT_OPTIONS$1), initializeOptions$1(options));
	if (isPresent(opts.byeaster)) opts.freq = RRule.YEARLY;
	if (!(isPresent(opts.freq) && RRule.FREQUENCIES[opts.freq])) throw new Error("Invalid frequency: ".concat(opts.freq, " ").concat(options.freq));
	if (!opts.dtstart) opts.dtstart = new Date((/* @__PURE__ */ new Date()).setMilliseconds(0));
	if (!isPresent(opts.wkst)) opts.wkst = RRule.MO.weekday;
	else if (isNumber(opts.wkst)) {} else opts.wkst = opts.wkst.weekday;
	if (isPresent(opts.bysetpos)) {
		if (isNumber(opts.bysetpos)) opts.bysetpos = [opts.bysetpos];
		for (var i = 0; i < opts.bysetpos.length; i++) {
			var v = opts.bysetpos[i];
			if (v === 0 || !(v >= -366 && v <= 366)) throw new Error("bysetpos must be between 1 and 366, or between -366 and -1");
		}
	}
	if (!(Boolean(opts.byweekno) || notEmpty(opts.byweekno) || notEmpty(opts.byyearday) || Boolean(opts.bymonthday) || notEmpty(opts.bymonthday) || isPresent(opts.byweekday) || isPresent(opts.byeaster))) switch (opts.freq) {
		case RRule.YEARLY:
			if (!opts.bymonth) opts.bymonth = opts.dtstart.getUTCMonth() + 1;
			opts.bymonthday = opts.dtstart.getUTCDate();
			break;
		case RRule.MONTHLY:
			opts.bymonthday = opts.dtstart.getUTCDate();
			break;
		case RRule.WEEKLY: opts.byweekday = [getWeekday(opts.dtstart)];
	}
	if (isPresent(opts.bymonth) && !isArray(opts.bymonth)) opts.bymonth = [opts.bymonth];
	if (isPresent(opts.byyearday) && !isArray(opts.byyearday) && isNumber(opts.byyearday)) opts.byyearday = [opts.byyearday];
	if (!isPresent(opts.bymonthday)) {
		opts.bymonthday = [];
		opts.bynmonthday = [];
	} else if (isArray(opts.bymonthday)) {
		var bymonthday = [];
		var bynmonthday = [];
		for (var i = 0; i < opts.bymonthday.length; i++) {
			var v = opts.bymonthday[i];
			if (v > 0) bymonthday.push(v);
			else if (v < 0) bynmonthday.push(v);
		}
		opts.bymonthday = bymonthday;
		opts.bynmonthday = bynmonthday;
	} else if (opts.bymonthday < 0) {
		opts.bynmonthday = [opts.bymonthday];
		opts.bymonthday = [];
	} else {
		opts.bynmonthday = [];
		opts.bymonthday = [opts.bymonthday];
	}
	if (isPresent(opts.byweekno) && !isArray(opts.byweekno)) opts.byweekno = [opts.byweekno];
	if (!isPresent(opts.byweekday)) opts.bynweekday = null;
	else if (isNumber(opts.byweekday)) {
		opts.byweekday = [opts.byweekday];
		opts.bynweekday = null;
	} else if (isWeekdayStr(opts.byweekday)) {
		opts.byweekday = [Weekday.fromStr(opts.byweekday).weekday];
		opts.bynweekday = null;
	} else if (opts.byweekday instanceof Weekday) if (!opts.byweekday.n || opts.freq > RRule.MONTHLY) {
		opts.byweekday = [opts.byweekday.weekday];
		opts.bynweekday = null;
	} else {
		opts.bynweekday = [[opts.byweekday.weekday, opts.byweekday.n]];
		opts.byweekday = null;
	}
	else {
		var byweekday = [];
		var bynweekday = [];
		for (var i = 0; i < opts.byweekday.length; i++) {
			var wday = opts.byweekday[i];
			if (isNumber(wday)) {
				byweekday.push(wday);
				continue;
			} else if (isWeekdayStr(wday)) {
				byweekday.push(Weekday.fromStr(wday).weekday);
				continue;
			}
			if (!wday.n || opts.freq > RRule.MONTHLY) byweekday.push(wday.weekday);
			else bynweekday.push([wday.weekday, wday.n]);
		}
		opts.byweekday = notEmpty(byweekday) ? byweekday : null;
		opts.bynweekday = notEmpty(bynweekday) ? bynweekday : null;
	}
	if (!isPresent(opts.byhour)) opts.byhour = opts.freq < RRule.HOURLY ? [opts.dtstart.getUTCHours()] : null;
	else if (isNumber(opts.byhour)) opts.byhour = [opts.byhour];
	if (!isPresent(opts.byminute)) opts.byminute = opts.freq < RRule.MINUTELY ? [opts.dtstart.getUTCMinutes()] : null;
	else if (isNumber(opts.byminute)) opts.byminute = [opts.byminute];
	if (!isPresent(opts.bysecond)) opts.bysecond = opts.freq < RRule.SECONDLY ? [opts.dtstart.getUTCSeconds()] : null;
	else if (isNumber(opts.bysecond)) opts.bysecond = [opts.bysecond];
	return { parsedOptions: opts };
}
function buildTimeset(opts) {
	var millisecondModulo = opts.dtstart.getTime() % 1e3;
	if (!freqIsDailyOrGreater(opts.freq)) return [];
	var timeset = [];
	opts.byhour.forEach(function(hour) {
		opts.byminute.forEach(function(minute) {
			opts.bysecond.forEach(function(second) {
				timeset.push(new Time(hour, minute, second, millisecondModulo));
			});
		});
	});
	return timeset;
}
//#endregion
//#region node_modules/rrule/dist/esm/parsestring.js
function parseString(rfcString) {
	var options = rfcString.split("\n").map(parseLine).filter(function(x) {
		return x !== null;
	});
	return __assign(__assign({}, options[0]), options[1]);
}
function parseDtstart(line) {
	var options = {};
	var dtstartWithZone = /DTSTART(?:;TZID=([^:=]+?))?(?::|=)([^;\s]+)/i.exec(line);
	if (!dtstartWithZone) return options;
	var tzid = dtstartWithZone[1], dtstart = dtstartWithZone[2];
	if (tzid) options.tzid = tzid;
	options.dtstart = untilStringToDate(dtstart);
	return options;
}
function parseLine(rfcString) {
	rfcString = rfcString.replace(/^\s+|\s+$/, "");
	if (!rfcString.length) return null;
	var header = /^([A-Z]+?)[:;]/.exec(rfcString.toUpperCase());
	if (!header) return parseRrule(rfcString);
	var key = header[1];
	switch (key.toUpperCase()) {
		case "RRULE":
		case "EXRULE": return parseRrule(rfcString);
		case "DTSTART": return parseDtstart(rfcString);
		default: throw new Error("Unsupported RFC prop ".concat(key, " in ").concat(rfcString));
	}
}
function parseRrule(line) {
	var options = parseDtstart(line.replace(/^RRULE:/i, ""));
	line.replace(/^(?:RRULE|EXRULE):/i, "").split(";").forEach(function(attr) {
		var _a = attr.split("="), key = _a[0], value = _a[1];
		switch (key.toUpperCase()) {
			case "FREQ":
				options.freq = Frequency[value.toUpperCase()];
				break;
			case "WKST":
				options.wkst = Days[value.toUpperCase()];
				break;
			case "COUNT":
			case "INTERVAL":
			case "BYSETPOS":
			case "BYMONTH":
			case "BYMONTHDAY":
			case "BYYEARDAY":
			case "BYWEEKNO":
			case "BYHOUR":
			case "BYMINUTE":
			case "BYSECOND":
				var num = parseNumber(value);
				var optionKey = key.toLowerCase();
				options[optionKey] = num;
				break;
			case "BYWEEKDAY":
			case "BYDAY":
				options.byweekday = parseWeekday(value);
				break;
			case "DTSTART":
			case "TZID":
				var dtstart = parseDtstart(line);
				options.tzid = dtstart.tzid;
				options.dtstart = dtstart.dtstart;
				break;
			case "UNTIL":
				options.until = untilStringToDate(value);
				break;
			case "BYEASTER":
				options.byeaster = Number(value);
				break;
			default: throw new Error("Unknown RRULE property '" + key + "'");
		}
	});
	return options;
}
function parseNumber(value) {
	if (value.indexOf(",") !== -1) return value.split(",").map(parseIndividualNumber);
	return parseIndividualNumber(value);
}
function parseIndividualNumber(value) {
	if (/^[+-]?\d+$/.test(value)) return Number(value);
	return value;
}
function parseWeekday(value) {
	return value.split(",").map(function(day) {
		if (day.length === 2) return Days[day];
		var parts = day.match(/^([+-]?\d{1,2})([A-Z]{2})$/);
		if (!parts || parts.length < 3) throw new SyntaxError("Invalid weekday string: ".concat(day));
		var n = Number(parts[1]);
		var wday = Days[parts[2]].weekday;
		return new Weekday(wday, n);
	});
}
//#endregion
//#region node_modules/rrule/dist/esm/datewithzone.js
var DateWithZone = function() {
	function DateWithZone(date, tzid) {
		if (isNaN(date.getTime())) throw new RangeError("Invalid date passed to DateWithZone");
		this.date = date;
		this.tzid = tzid;
	}
	Object.defineProperty(DateWithZone.prototype, "isUTC", {
		get: function() {
			return !this.tzid || this.tzid.toUpperCase() === "UTC";
		},
		enumerable: false,
		configurable: true
	});
	DateWithZone.prototype.toString = function() {
		var datestr = timeToUntilString(this.date.getTime(), this.isUTC);
		if (!this.isUTC) return ";TZID=".concat(this.tzid, ":").concat(datestr);
		return ":".concat(datestr);
	};
	DateWithZone.prototype.getTime = function() {
		return this.date.getTime();
	};
	DateWithZone.prototype.rezonedDate = function() {
		if (this.isUTC) return this.date;
		return dateInTimeZone(this.date, this.tzid);
	};
	return DateWithZone;
}();
//#endregion
//#region node_modules/rrule/dist/esm/optionstostring.js
function optionsToString(options) {
	var rrule = [];
	var dtstart = "";
	var keys = Object.keys(options);
	var defaultKeys = Object.keys(DEFAULT_OPTIONS$1);
	for (var i = 0; i < keys.length; i++) {
		if (keys[i] === "tzid") continue;
		if (!includes(defaultKeys, keys[i])) continue;
		var key = keys[i].toUpperCase();
		var value = options[keys[i]];
		var outValue = "";
		if (!isPresent(value) || isArray(value) && !value.length) continue;
		switch (key) {
			case "FREQ":
				outValue = RRule.FREQUENCIES[options.freq];
				break;
			case "WKST":
				if (isNumber(value)) outValue = new Weekday(value).toString();
				else outValue = value.toString();
				break;
			case "BYWEEKDAY":
				key = "BYDAY";
				outValue = toArray(value).map(function(wday) {
					if (wday instanceof Weekday) return wday;
					if (isArray(wday)) return new Weekday(wday[0], wday[1]);
					return new Weekday(wday);
				}).toString();
				break;
			case "DTSTART":
				dtstart = buildDtstart(value, options.tzid);
				break;
			case "UNTIL":
				outValue = timeToUntilString(value, !options.tzid);
				break;
			default: if (isArray(value)) {
				var strValues = [];
				for (var j = 0; j < value.length; j++) strValues[j] = String(value[j]);
				outValue = strValues.toString();
			} else outValue = String(value);
		}
		if (outValue) rrule.push([key, outValue]);
	}
	var rules = rrule.map(function(_a) {
		var key = _a[0], value = _a[1];
		return "".concat(key, "=").concat(value.toString());
	}).join(";");
	var ruleString = "";
	if (rules !== "") ruleString = "RRULE:".concat(rules);
	return [dtstart, ruleString].filter(function(x) {
		return !!x;
	}).join("\n");
}
function buildDtstart(dtstart, tzid) {
	if (!dtstart) return "";
	return "DTSTART" + new DateWithZone(new Date(dtstart), tzid).toString();
}
//#endregion
//#region node_modules/rrule/dist/esm/cache.js
function argsMatch(left, right) {
	if (Array.isArray(left)) {
		if (!Array.isArray(right)) return false;
		if (left.length !== right.length) return false;
		return left.every(function(date, i) {
			return date.getTime() === right[i].getTime();
		});
	}
	if (left instanceof Date) return right instanceof Date && left.getTime() === right.getTime();
	return left === right;
}
var Cache = function() {
	function Cache() {
		this.all = false;
		this.before = [];
		this.after = [];
		this.between = [];
	}
	/**
	* @param {String} what - all/before/after/between
	* @param {Array,Date} value - an array of dates, one date, or null
	* @param {Object?} args - _iter arguments
	*/
	Cache.prototype._cacheAdd = function(what, value, args) {
		if (value) value = value instanceof Date ? clone(value) : cloneDates(value);
		if (what === "all") this.all = value;
		else {
			args._value = value;
			this[what].push(args);
		}
	};
	/**
	* @return false - not in the cache
	* @return null  - cached, but zero occurrences (before/after)
	* @return Date  - cached (before/after)
	* @return []    - cached, but zero occurrences (all/between)
	* @return [Date1, DateN] - cached (all/between)
	*/
	Cache.prototype._cacheGet = function(what, args) {
		var cached = false;
		var argsKeys = args ? Object.keys(args) : [];
		var findCacheDiff = function(item) {
			for (var i = 0; i < argsKeys.length; i++) {
				var key = argsKeys[i];
				if (!argsMatch(args[key], item[key])) return true;
			}
			return false;
		};
		var cachedObject = this[what];
		if (what === "all") cached = this.all;
		else if (isArray(cachedObject)) for (var i = 0; i < cachedObject.length; i++) {
			var item = cachedObject[i];
			if (argsKeys.length && findCacheDiff(item)) continue;
			cached = item._value;
			break;
		}
		if (!cached && this.all) {
			var iterResult = new IterResult(what, args);
			for (var i = 0; i < this.all.length; i++) if (!iterResult.accept(this.all[i])) break;
			cached = iterResult.getValue();
			this._cacheAdd(what, cached, args);
		}
		return isArray(cached) ? cloneDates(cached) : cached instanceof Date ? clone(cached) : cached;
	};
	return Cache;
}();
//#endregion
//#region node_modules/rrule/dist/esm/masks.js
var M365MASK = __spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray([], repeat(1, 31), true), repeat(2, 28), true), repeat(3, 31), true), repeat(4, 30), true), repeat(5, 31), true), repeat(6, 30), true), repeat(7, 31), true), repeat(8, 31), true), repeat(9, 30), true), repeat(10, 31), true), repeat(11, 30), true), repeat(12, 31), true), repeat(1, 7), true);
var M366MASK = __spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray([], repeat(1, 31), true), repeat(2, 29), true), repeat(3, 31), true), repeat(4, 30), true), repeat(5, 31), true), repeat(6, 30), true), repeat(7, 31), true), repeat(8, 31), true), repeat(9, 30), true), repeat(10, 31), true), repeat(11, 30), true), repeat(12, 31), true), repeat(1, 7), true);
var M28 = range(1, 29);
var M29 = range(1, 30);
var M30 = range(1, 31);
var M31 = range(1, 32);
var MDAY366MASK = __spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray([], M31, true), M29, true), M31, true), M30, true), M31, true), M30, true), M31, true), M31, true), M30, true), M31, true), M30, true), M31, true), M31.slice(0, 7), true);
var MDAY365MASK = __spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray([], M31, true), M28, true), M31, true), M30, true), M31, true), M30, true), M31, true), M31, true), M30, true), M31, true), M30, true), M31, true), M31.slice(0, 7), true);
var NM28 = range(-28, 0);
var NM29 = range(-29, 0);
var NM30 = range(-30, 0);
var NM31 = range(-31, 0);
var NMDAY366MASK = __spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray([], NM31, true), NM29, true), NM31, true), NM30, true), NM31, true), NM30, true), NM31, true), NM31, true), NM30, true), NM31, true), NM30, true), NM31, true), NM31.slice(0, 7), true);
var NMDAY365MASK = __spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray([], NM31, true), NM28, true), NM31, true), NM30, true), NM31, true), NM30, true), NM31, true), NM31, true), NM30, true), NM31, true), NM30, true), NM31, true), NM31.slice(0, 7), true);
var M366RANGE = [
	0,
	31,
	60,
	91,
	121,
	152,
	182,
	213,
	244,
	274,
	305,
	335,
	366
];
var M365RANGE = [
	0,
	31,
	59,
	90,
	120,
	151,
	181,
	212,
	243,
	273,
	304,
	334,
	365
];
var WDAYMASK = (function() {
	var wdaymask = [];
	for (var i = 0; i < 55; i++) wdaymask = wdaymask.concat(range(7));
	return wdaymask;
})();
//#endregion
//#region node_modules/rrule/dist/esm/iterinfo/yearinfo.js
function rebuildYear(year, options) {
	var firstyday = datetime(year, 1, 1);
	var yearlen = isLeapYear(year) ? 366 : 365;
	var nextyearlen = isLeapYear(year + 1) ? 366 : 365;
	var yearordinal = toOrdinal(firstyday);
	var yearweekday = getWeekday(firstyday);
	var result = __assign(__assign({
		yearlen,
		nextyearlen,
		yearordinal,
		yearweekday
	}, baseYearMasks(year)), { wnomask: null });
	if (empty(options.byweekno)) return result;
	result.wnomask = repeat(0, yearlen + 7);
	var firstwkst;
	var wyearlen;
	var no1wkst = firstwkst = pymod(7 - yearweekday + options.wkst, 7);
	if (no1wkst >= 4) {
		no1wkst = 0;
		wyearlen = result.yearlen + pymod(yearweekday - options.wkst, 7);
	} else wyearlen = yearlen - no1wkst;
	var div = Math.floor(wyearlen / 7);
	var mod = pymod(wyearlen, 7);
	var numweeks = Math.floor(div + mod / 4);
	for (var j = 0; j < options.byweekno.length; j++) {
		var n = options.byweekno[j];
		if (n < 0) n += numweeks + 1;
		if (!(n > 0 && n <= numweeks)) continue;
		var i = void 0;
		if (n > 1) {
			i = no1wkst + (n - 1) * 7;
			if (no1wkst !== firstwkst) i -= 7 - firstwkst;
		} else i = no1wkst;
		for (var k = 0; k < 7; k++) {
			result.wnomask[i] = 1;
			i++;
			if (result.wdaymask[i] === options.wkst) break;
		}
	}
	if (includes(options.byweekno, 1)) {
		var i = no1wkst + numweeks * 7;
		if (no1wkst !== firstwkst) i -= 7 - firstwkst;
		if (i < yearlen) for (var j = 0; j < 7; j++) {
			result.wnomask[i] = 1;
			i += 1;
			if (result.wdaymask[i] === options.wkst) break;
		}
	}
	if (no1wkst) {
		var lnumweeks = void 0;
		if (!includes(options.byweekno, -1)) {
			var lyearweekday = getWeekday(datetime(year - 1, 1, 1));
			var lno1wkst = pymod(7 - lyearweekday.valueOf() + options.wkst, 7);
			var lyearlen = isLeapYear(year - 1) ? 366 : 365;
			var weekst = void 0;
			if (lno1wkst >= 4) {
				lno1wkst = 0;
				weekst = lyearlen + pymod(lyearweekday - options.wkst, 7);
			} else weekst = yearlen - no1wkst;
			lnumweeks = Math.floor(52 + pymod(weekst, 7) / 4);
		} else lnumweeks = -1;
		if (includes(options.byweekno, lnumweeks)) for (var i = 0; i < no1wkst; i++) result.wnomask[i] = 1;
	}
	return result;
}
function baseYearMasks(year) {
	var yearlen = isLeapYear(year) ? 366 : 365;
	var wday = getWeekday(datetime(year, 1, 1));
	if (yearlen === 365) return {
		mmask: M365MASK,
		mdaymask: MDAY365MASK,
		nmdaymask: NMDAY365MASK,
		wdaymask: WDAYMASK.slice(wday),
		mrange: M365RANGE
	};
	return {
		mmask: M366MASK,
		mdaymask: MDAY366MASK,
		nmdaymask: NMDAY366MASK,
		wdaymask: WDAYMASK.slice(wday),
		mrange: M366RANGE
	};
}
//#endregion
//#region node_modules/rrule/dist/esm/iterinfo/monthinfo.js
function rebuildMonth(year, month, yearlen, mrange, wdaymask, options) {
	var result = {
		lastyear: year,
		lastmonth: month,
		nwdaymask: []
	};
	var ranges = [];
	if (options.freq === RRule.YEARLY) if (empty(options.bymonth)) ranges = [[0, yearlen]];
	else for (var j = 0; j < options.bymonth.length; j++) {
		month = options.bymonth[j];
		ranges.push(mrange.slice(month - 1, month + 1));
	}
	else if (options.freq === RRule.MONTHLY) ranges = [mrange.slice(month - 1, month + 1)];
	if (empty(ranges)) return result;
	result.nwdaymask = repeat(0, yearlen);
	for (var j = 0; j < ranges.length; j++) {
		var rang = ranges[j];
		var first = rang[0];
		var last = rang[1] - 1;
		for (var k = 0; k < options.bynweekday.length; k++) {
			var i = void 0;
			var _a = options.bynweekday[k], wday = _a[0], n = _a[1];
			if (n < 0) {
				i = last + (n + 1) * 7;
				i -= pymod(wdaymask[i] - wday, 7);
			} else {
				i = first + (n - 1) * 7;
				i += pymod(7 - wdaymask[i] + wday, 7);
			}
			if (first <= i && i <= last) result.nwdaymask[i] = 1;
		}
	}
	return result;
}
//#endregion
//#region node_modules/rrule/dist/esm/iterinfo/easter.js
function easter(y, offset) {
	if (offset === void 0) offset = 0;
	var a = y % 19;
	var b = Math.floor(y / 100);
	var c = y % 100;
	var d = Math.floor(b / 4);
	var e = b % 4;
	var f = Math.floor((b + 8) / 25);
	var g = Math.floor((b - f + 1) / 3);
	var h = Math.floor(19 * a + b - d - g + 15) % 30;
	var i = Math.floor(c / 4);
	var k = c % 4;
	var l = Math.floor(32 + 2 * e + 2 * i - h - k) % 7;
	var m = Math.floor((a + 11 * h + 22 * l) / 451);
	var month = Math.floor((h + l - 7 * m + 114) / 31);
	var day = (h + l - 7 * m + 114) % 31 + 1;
	var date = Date.UTC(y, month - 1, day + offset);
	return [Math.ceil((date - Date.UTC(y, 0, 1)) / 864e5)];
}
//#endregion
//#region node_modules/rrule/dist/esm/iterinfo/index.js
var Iterinfo = function() {
	function Iterinfo(options) {
		this.options = options;
	}
	Iterinfo.prototype.rebuild = function(year, month) {
		var options = this.options;
		if (year !== this.lastyear) this.yearinfo = rebuildYear(year, options);
		if (notEmpty(options.bynweekday) && (month !== this.lastmonth || year !== this.lastyear)) {
			var _a = this.yearinfo, yearlen = _a.yearlen, mrange = _a.mrange, wdaymask = _a.wdaymask;
			this.monthinfo = rebuildMonth(year, month, yearlen, mrange, wdaymask, options);
		}
		if (isPresent(options.byeaster)) this.eastermask = easter(year, options.byeaster);
	};
	Object.defineProperty(Iterinfo.prototype, "lastyear", {
		get: function() {
			return this.monthinfo ? this.monthinfo.lastyear : null;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "lastmonth", {
		get: function() {
			return this.monthinfo ? this.monthinfo.lastmonth : null;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "yearlen", {
		get: function() {
			return this.yearinfo.yearlen;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "yearordinal", {
		get: function() {
			return this.yearinfo.yearordinal;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "mrange", {
		get: function() {
			return this.yearinfo.mrange;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "wdaymask", {
		get: function() {
			return this.yearinfo.wdaymask;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "mmask", {
		get: function() {
			return this.yearinfo.mmask;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "wnomask", {
		get: function() {
			return this.yearinfo.wnomask;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "nwdaymask", {
		get: function() {
			return this.monthinfo ? this.monthinfo.nwdaymask : [];
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "nextyearlen", {
		get: function() {
			return this.yearinfo.nextyearlen;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "mdaymask", {
		get: function() {
			return this.yearinfo.mdaymask;
		},
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(Iterinfo.prototype, "nmdaymask", {
		get: function() {
			return this.yearinfo.nmdaymask;
		},
		enumerable: false,
		configurable: true
	});
	Iterinfo.prototype.ydayset = function() {
		return [
			range(this.yearlen),
			0,
			this.yearlen
		];
	};
	Iterinfo.prototype.mdayset = function(_, month) {
		var start = this.mrange[month - 1];
		var end = this.mrange[month];
		var set = repeat(null, this.yearlen);
		for (var i = start; i < end; i++) set[i] = i;
		return [
			set,
			start,
			end
		];
	};
	Iterinfo.prototype.wdayset = function(year, month, day) {
		var set = repeat(null, this.yearlen + 7);
		var i = toOrdinal(datetime(year, month, day)) - this.yearordinal;
		var start = i;
		for (var j = 0; j < 7; j++) {
			set[i] = i;
			++i;
			if (this.wdaymask[i] === this.options.wkst) break;
		}
		return [
			set,
			start,
			i
		];
	};
	Iterinfo.prototype.ddayset = function(year, month, day) {
		var set = repeat(null, this.yearlen);
		var i = toOrdinal(datetime(year, month, day)) - this.yearordinal;
		set[i] = i;
		return [
			set,
			i,
			i + 1
		];
	};
	Iterinfo.prototype.htimeset = function(hour, _, second, millisecond) {
		var _this = this;
		var set = [];
		this.options.byminute.forEach(function(minute) {
			set = set.concat(_this.mtimeset(hour, minute, second, millisecond));
		});
		sort(set);
		return set;
	};
	Iterinfo.prototype.mtimeset = function(hour, minute, _, millisecond) {
		var set = this.options.bysecond.map(function(second) {
			return new Time(hour, minute, second, millisecond);
		});
		sort(set);
		return set;
	};
	Iterinfo.prototype.stimeset = function(hour, minute, second, millisecond) {
		return [new Time(hour, minute, second, millisecond)];
	};
	Iterinfo.prototype.getdayset = function(freq) {
		switch (freq) {
			case Frequency.YEARLY: return this.ydayset.bind(this);
			case Frequency.MONTHLY: return this.mdayset.bind(this);
			case Frequency.WEEKLY: return this.wdayset.bind(this);
			case Frequency.DAILY: return this.ddayset.bind(this);
			default: return this.ddayset.bind(this);
		}
	};
	Iterinfo.prototype.gettimeset = function(freq) {
		switch (freq) {
			case Frequency.HOURLY: return this.htimeset.bind(this);
			case Frequency.MINUTELY: return this.mtimeset.bind(this);
			case Frequency.SECONDLY: return this.stimeset.bind(this);
		}
	};
	return Iterinfo;
}();
//#endregion
//#region node_modules/rrule/dist/esm/iter/poslist.js
function buildPoslist(bysetpos, timeset, start, end, ii, dayset) {
	var poslist = [];
	for (var j = 0; j < bysetpos.length; j++) {
		var daypos = void 0;
		var timepos = void 0;
		var pos = bysetpos[j];
		if (pos < 0) {
			daypos = Math.floor(pos / timeset.length);
			timepos = pymod(pos, timeset.length);
		} else {
			daypos = Math.floor((pos - 1) / timeset.length);
			timepos = pymod(pos - 1, timeset.length);
		}
		var tmp = [];
		for (var k = start; k < end; k++) {
			var val = dayset[k];
			if (!isPresent(val)) continue;
			tmp.push(val);
		}
		var i = void 0;
		if (daypos < 0) i = tmp.slice(daypos)[0];
		else i = tmp[daypos];
		var time = timeset[timepos];
		var res = combine(fromOrdinal(ii.yearordinal + i), time);
		if (!includes(poslist, res)) poslist.push(res);
	}
	sort(poslist);
	return poslist;
}
//#endregion
//#region node_modules/rrule/dist/esm/iter/index.js
function iter(iterResult, options) {
	var dtstart = options.dtstart, freq = options.freq, interval = options.interval, until = options.until, bysetpos = options.bysetpos;
	var count = options.count;
	if (count === 0 || interval === 0) return emitResult(iterResult);
	var counterDate = DateTime.fromDate(dtstart);
	var ii = new Iterinfo(options);
	ii.rebuild(counterDate.year, counterDate.month);
	var timeset = makeTimeset(ii, counterDate, options);
	for (;;) {
		var _a = ii.getdayset(freq)(counterDate.year, counterDate.month, counterDate.day), dayset = _a[0], start = _a[1], end = _a[2];
		var filtered = removeFilteredDays(dayset, start, end, ii, options);
		if (notEmpty(bysetpos)) {
			var poslist = buildPoslist(bysetpos, timeset, start, end, ii, dayset);
			for (var j = 0; j < poslist.length; j++) {
				var res = poslist[j];
				if (until && res > until) return emitResult(iterResult);
				if (res >= dtstart) {
					var rezonedDate = rezoneIfNeeded(res, options);
					if (!iterResult.accept(rezonedDate)) return emitResult(iterResult);
					if (count) {
						--count;
						if (!count) return emitResult(iterResult);
					}
				}
			}
		} else for (var j = start; j < end; j++) {
			var currentDay = dayset[j];
			if (!isPresent(currentDay)) continue;
			var date = fromOrdinal(ii.yearordinal + currentDay);
			for (var k = 0; k < timeset.length; k++) {
				var time = timeset[k];
				var res = combine(date, time);
				if (until && res > until) return emitResult(iterResult);
				if (res >= dtstart) {
					var rezonedDate = rezoneIfNeeded(res, options);
					if (!iterResult.accept(rezonedDate)) return emitResult(iterResult);
					if (count) {
						--count;
						if (!count) return emitResult(iterResult);
					}
				}
			}
		}
		if (options.interval === 0) return emitResult(iterResult);
		counterDate.add(options, filtered);
		if (counterDate.year > 9999) return emitResult(iterResult);
		if (!freqIsDailyOrGreater(freq)) timeset = ii.gettimeset(freq)(counterDate.hour, counterDate.minute, counterDate.second, 0);
		ii.rebuild(counterDate.year, counterDate.month);
	}
}
function isFiltered(ii, currentDay, options) {
	var bymonth = options.bymonth, byweekno = options.byweekno, byweekday = options.byweekday, byeaster = options.byeaster, bymonthday = options.bymonthday, bynmonthday = options.bynmonthday, byyearday = options.byyearday;
	return notEmpty(bymonth) && !includes(bymonth, ii.mmask[currentDay]) || notEmpty(byweekno) && !ii.wnomask[currentDay] || notEmpty(byweekday) && !includes(byweekday, ii.wdaymask[currentDay]) || notEmpty(ii.nwdaymask) && !ii.nwdaymask[currentDay] || byeaster !== null && !includes(ii.eastermask, currentDay) || (notEmpty(bymonthday) || notEmpty(bynmonthday)) && !includes(bymonthday, ii.mdaymask[currentDay]) && !includes(bynmonthday, ii.nmdaymask[currentDay]) || notEmpty(byyearday) && (currentDay < ii.yearlen && !includes(byyearday, currentDay + 1) && !includes(byyearday, -ii.yearlen + currentDay) || currentDay >= ii.yearlen && !includes(byyearday, currentDay + 1 - ii.yearlen) && !includes(byyearday, -ii.nextyearlen + currentDay - ii.yearlen));
}
function rezoneIfNeeded(date, options) {
	return new DateWithZone(date, options.tzid).rezonedDate();
}
function emitResult(iterResult) {
	return iterResult.getValue();
}
function removeFilteredDays(dayset, start, end, ii, options) {
	var filtered = false;
	for (var dayCounter = start; dayCounter < end; dayCounter++) {
		var currentDay = dayset[dayCounter];
		filtered = isFiltered(ii, currentDay, options);
		if (filtered) dayset[currentDay] = null;
	}
	return filtered;
}
function makeTimeset(ii, counterDate, options) {
	var freq = options.freq, byhour = options.byhour, byminute = options.byminute, bysecond = options.bysecond;
	if (freqIsDailyOrGreater(freq)) return buildTimeset(options);
	if (freq >= RRule.HOURLY && notEmpty(byhour) && !includes(byhour, counterDate.hour) || freq >= RRule.MINUTELY && notEmpty(byminute) && !includes(byminute, counterDate.minute) || freq >= RRule.SECONDLY && notEmpty(bysecond) && !includes(bysecond, counterDate.second)) return [];
	return ii.gettimeset(freq)(counterDate.hour, counterDate.minute, counterDate.second, counterDate.millisecond);
}
//#endregion
//#region node_modules/rrule/dist/esm/rrule.js
var Days = {
	MO: new Weekday(0),
	TU: new Weekday(1),
	WE: new Weekday(2),
	TH: new Weekday(3),
	FR: new Weekday(4),
	SA: new Weekday(5),
	SU: new Weekday(6)
};
var DEFAULT_OPTIONS$1 = {
	freq: Frequency.YEARLY,
	dtstart: null,
	interval: 1,
	wkst: Days.MO,
	count: null,
	until: null,
	tzid: null,
	bysetpos: null,
	bymonth: null,
	bymonthday: null,
	bynmonthday: null,
	byyearday: null,
	byweekno: null,
	byweekday: null,
	bynweekday: null,
	byhour: null,
	byminute: null,
	bysecond: null,
	byeaster: null
};
var defaultKeys = Object.keys(DEFAULT_OPTIONS$1);
/**
*
* @param {Options?} options - see <http://labix.org/python-dateutil/#head-cf004ee9a75592797e076752b2a889c10f445418>
* - The only required option is `freq`, one of RRule.YEARLY, RRule.MONTHLY, ...
* @constructor
*/
var RRule = function() {
	function RRule(options, noCache) {
		if (options === void 0) options = {};
		if (noCache === void 0) noCache = false;
		this._cache = noCache ? null : new Cache();
		this.origOptions = initializeOptions$1(options);
		var parsedOptions = parseOptions(options).parsedOptions;
		this.options = parsedOptions;
	}
	RRule.parseText = function(text, language) {
		return parseText(text, language);
	};
	RRule.fromText = function(text, language) {
		return fromText(text, language);
	};
	RRule.fromString = function(str) {
		return new RRule(RRule.parseString(str) || void 0);
	};
	RRule.prototype._iter = function(iterResult) {
		return iter(iterResult, this.options);
	};
	RRule.prototype._cacheGet = function(what, args) {
		if (!this._cache) return false;
		return this._cache._cacheGet(what, args);
	};
	RRule.prototype._cacheAdd = function(what, value, args) {
		if (!this._cache) return;
		return this._cache._cacheAdd(what, value, args);
	};
	/**
	* @param {Function} iterator - optional function that will be called
	* on each date that is added. It can return false
	* to stop the iteration.
	* @return Array containing all recurrences.
	*/
	RRule.prototype.all = function(iterator) {
		if (iterator) return this._iter(new CallbackIterResult("all", {}, iterator));
		var result = this._cacheGet("all");
		if (result === false) {
			result = this._iter(new IterResult("all", {}));
			this._cacheAdd("all", result);
		}
		return result;
	};
	/**
	* Returns all the occurrences of the rrule between after and before.
	* The inc keyword defines what happens if after and/or before are
	* themselves occurrences. With inc == True, they will be included in the
	* list, if they are found in the recurrence set.
	*
	* @return Array
	*/
	RRule.prototype.between = function(after, before, inc, iterator) {
		if (inc === void 0) inc = false;
		if (!isValidDate(after) || !isValidDate(before)) throw new Error("Invalid date passed in to RRule.between");
		var args = {
			before,
			after,
			inc
		};
		if (iterator) return this._iter(new CallbackIterResult("between", args, iterator));
		var result = this._cacheGet("between", args);
		if (result === false) {
			result = this._iter(new IterResult("between", args));
			this._cacheAdd("between", result, args);
		}
		return result;
	};
	/**
	* Returns the last recurrence before the given datetime instance.
	* The inc keyword defines what happens if dt is an occurrence.
	* With inc == True, if dt itself is an occurrence, it will be returned.
	*
	* @return Date or null
	*/
	RRule.prototype.before = function(dt, inc) {
		if (inc === void 0) inc = false;
		if (!isValidDate(dt)) throw new Error("Invalid date passed in to RRule.before");
		var args = {
			dt,
			inc
		};
		var result = this._cacheGet("before", args);
		if (result === false) {
			result = this._iter(new IterResult("before", args));
			this._cacheAdd("before", result, args);
		}
		return result;
	};
	/**
	* Returns the first recurrence after the given datetime instance.
	* The inc keyword defines what happens if dt is an occurrence.
	* With inc == True, if dt itself is an occurrence, it will be returned.
	*
	* @return Date or null
	*/
	RRule.prototype.after = function(dt, inc) {
		if (inc === void 0) inc = false;
		if (!isValidDate(dt)) throw new Error("Invalid date passed in to RRule.after");
		var args = {
			dt,
			inc
		};
		var result = this._cacheGet("after", args);
		if (result === false) {
			result = this._iter(new IterResult("after", args));
			this._cacheAdd("after", result, args);
		}
		return result;
	};
	/**
	* Returns the number of recurrences in this set. It will have go trough
	* the whole recurrence, if this hasn't been done before.
	*/
	RRule.prototype.count = function() {
		return this.all().length;
	};
	/**
	* Converts the rrule into its string representation
	*
	* @see <http://www.ietf.org/rfc/rfc2445.txt>
	* @return String
	*/
	RRule.prototype.toString = function() {
		return optionsToString(this.origOptions);
	};
	/**
	* Will convert all rules described in nlp:ToText
	* to text.
	*/
	RRule.prototype.toText = function(gettext, language, dateFormatter) {
		return toText(this, gettext, language, dateFormatter);
	};
	RRule.prototype.isFullyConvertibleToText = function() {
		return isFullyConvertible(this);
	};
	/**
	* @return a RRule instance with the same freq and options
	* as this one (cache is not cloned)
	*/
	RRule.prototype.clone = function() {
		return new RRule(this.origOptions);
	};
	RRule.FREQUENCIES = [
		"YEARLY",
		"MONTHLY",
		"WEEKLY",
		"DAILY",
		"HOURLY",
		"MINUTELY",
		"SECONDLY"
	];
	RRule.YEARLY = Frequency.YEARLY;
	RRule.MONTHLY = Frequency.MONTHLY;
	RRule.WEEKLY = Frequency.WEEKLY;
	RRule.DAILY = Frequency.DAILY;
	RRule.HOURLY = Frequency.HOURLY;
	RRule.MINUTELY = Frequency.MINUTELY;
	RRule.SECONDLY = Frequency.SECONDLY;
	RRule.MO = Days.MO;
	RRule.TU = Days.TU;
	RRule.WE = Days.WE;
	RRule.TH = Days.TH;
	RRule.FR = Days.FR;
	RRule.SA = Days.SA;
	RRule.SU = Days.SU;
	RRule.parseString = parseString;
	RRule.optionsToString = optionsToString;
	return RRule;
}();
//#endregion
//#region node_modules/rrule/dist/esm/iterset.js
function iterSet(iterResult, _rrule, _exrule, _rdate, _exdate, tzid) {
	var _exdateHash = {};
	var _accept = iterResult.accept;
	function evalExdate(after, before) {
		_exrule.forEach(function(rrule) {
			rrule.between(after, before, true).forEach(function(date) {
				_exdateHash[Number(date)] = true;
			});
		});
	}
	_exdate.forEach(function(date) {
		var zonedDate = new DateWithZone(date, tzid).rezonedDate();
		_exdateHash[Number(zonedDate)] = true;
	});
	iterResult.accept = function(date) {
		var dt = Number(date);
		if (isNaN(dt)) return _accept.call(this, date);
		if (!_exdateHash[dt]) {
			evalExdate(/* @__PURE__ */ new Date(dt - 1), new Date(dt + 1));
			if (!_exdateHash[dt]) {
				_exdateHash[dt] = true;
				return _accept.call(this, date);
			}
		}
		return true;
	};
	if (iterResult.method === "between") {
		evalExdate(iterResult.args.after, iterResult.args.before);
		iterResult.accept = function(date) {
			var dt = Number(date);
			if (!_exdateHash[dt]) {
				_exdateHash[dt] = true;
				return _accept.call(this, date);
			}
			return true;
		};
	}
	for (var i = 0; i < _rdate.length; i++) {
		var zonedDate = new DateWithZone(_rdate[i], tzid).rezonedDate();
		if (!iterResult.accept(new Date(zonedDate.getTime()))) break;
	}
	_rrule.forEach(function(rrule) {
		iter(iterResult, rrule.options);
	});
	var res = iterResult._result;
	sort(res);
	switch (iterResult.method) {
		case "all":
		case "between": return res;
		case "before": return res.length && res[res.length - 1] || null;
		default: return res.length && res[0] || null;
	}
}
//#endregion
//#region node_modules/rrule/dist/esm/rrulestr.js
/**
* RRuleStr
* To parse a set of rrule strings
*/
var DEFAULT_OPTIONS = {
	dtstart: null,
	cache: false,
	unfold: false,
	forceset: false,
	compatible: false,
	tzid: null
};
function parseInput(s, options) {
	var rrulevals = [];
	var rdatevals = [];
	var exrulevals = [];
	var exdatevals = [];
	var parsedDtstart = parseDtstart(s);
	var dtstart = parsedDtstart.dtstart;
	var tzid = parsedDtstart.tzid;
	splitIntoLines(s, options.unfold).forEach(function(line) {
		var _a;
		if (!line) return;
		var _b = breakDownLine(line), name = _b.name, parms = _b.parms, value = _b.value;
		switch (name.toUpperCase()) {
			case "RRULE":
				if (parms.length) throw new Error("unsupported RRULE parm: ".concat(parms.join(",")));
				rrulevals.push(parseString(line));
				break;
			case "RDATE":
				var rdateTzid = ((_a = /RDATE(?:;TZID=([^:=]+))?/i.exec(line)) !== null && _a !== void 0 ? _a : [])[1];
				if (rdateTzid && !tzid) tzid = rdateTzid;
				rdatevals = rdatevals.concat(parseRDate(value, parms));
				break;
			case "EXRULE":
				if (parms.length) throw new Error("unsupported EXRULE parm: ".concat(parms.join(",")));
				exrulevals.push(parseString(value));
				break;
			case "EXDATE":
				exdatevals = exdatevals.concat(parseRDate(value, parms));
				break;
			case "DTSTART": break;
			default: throw new Error("unsupported property: " + name);
		}
	});
	return {
		dtstart,
		tzid,
		rrulevals,
		rdatevals,
		exrulevals,
		exdatevals
	};
}
function buildRule(s, options) {
	var _a = parseInput(s, options), rrulevals = _a.rrulevals, rdatevals = _a.rdatevals, exrulevals = _a.exrulevals, exdatevals = _a.exdatevals, dtstart = _a.dtstart, tzid = _a.tzid;
	var noCache = options.cache === false;
	if (options.compatible) {
		options.forceset = true;
		options.unfold = true;
	}
	if (options.forceset || rrulevals.length > 1 || rdatevals.length || exrulevals.length || exdatevals.length) {
		var rset_1 = new RRuleSet(noCache);
		rset_1.dtstart(dtstart);
		rset_1.tzid(tzid || void 0);
		rrulevals.forEach(function(val) {
			rset_1.rrule(new RRule(groomRruleOptions(val, dtstart, tzid), noCache));
		});
		rdatevals.forEach(function(date) {
			rset_1.rdate(date);
		});
		exrulevals.forEach(function(val) {
			rset_1.exrule(new RRule(groomRruleOptions(val, dtstart, tzid), noCache));
		});
		exdatevals.forEach(function(date) {
			rset_1.exdate(date);
		});
		if (options.compatible && options.dtstart) rset_1.rdate(dtstart);
		return rset_1;
	}
	var val = rrulevals[0] || {};
	return new RRule(groomRruleOptions(val, val.dtstart || options.dtstart || dtstart, val.tzid || options.tzid || tzid), noCache);
}
function rrulestr(s, options) {
	if (options === void 0) options = {};
	return buildRule(s, initializeOptions(options));
}
function groomRruleOptions(val, dtstart, tzid) {
	return __assign(__assign({}, val), {
		dtstart,
		tzid
	});
}
function initializeOptions(options) {
	var invalid = [];
	var keys = Object.keys(options);
	var defaultKeys = Object.keys(DEFAULT_OPTIONS);
	keys.forEach(function(key) {
		if (!includes(defaultKeys, key)) invalid.push(key);
	});
	if (invalid.length) throw new Error("Invalid options: " + invalid.join(", "));
	return __assign(__assign({}, DEFAULT_OPTIONS), options);
}
function extractName(line) {
	if (line.indexOf(":") === -1) return {
		name: "RRULE",
		value: line
	};
	var _a = split(line, ":", 1);
	return {
		name: _a[0],
		value: _a[1]
	};
}
function breakDownLine(line) {
	var _a = extractName(line), name = _a.name, value = _a.value;
	var parms = name.split(";");
	if (!parms) throw new Error("empty property name");
	return {
		name: parms[0].toUpperCase(),
		parms: parms.slice(1),
		value
	};
}
function splitIntoLines(s, unfold) {
	if (unfold === void 0) unfold = false;
	s = s && s.trim();
	if (!s) throw new Error("Invalid empty string");
	if (!unfold) return s.split(/\s/);
	var lines = s.split("\n");
	var i = 0;
	while (i < lines.length) {
		var line = lines[i] = lines[i].replace(/\s+$/g, "");
		if (!line) lines.splice(i, 1);
		else if (i > 0 && line[0] === " ") {
			lines[i - 1] += line.slice(1);
			lines.splice(i, 1);
		} else i += 1;
	}
	return lines;
}
function validateDateParm(parms) {
	parms.forEach(function(parm) {
		if (!/(VALUE=DATE(-TIME)?)|(TZID=)/.test(parm)) throw new Error("unsupported RDATE/EXDATE parm: " + parm);
	});
}
function parseRDate(rdateval, parms) {
	validateDateParm(parms);
	return rdateval.split(",").map(function(datestr) {
		return untilStringToDate(datestr);
	});
}
//#endregion
//#region node_modules/rrule/dist/esm/rruleset.js
function createGetterSetter(fieldName) {
	var _this = this;
	return function(field) {
		if (field !== void 0) _this["_".concat(fieldName)] = field;
		if (_this["_".concat(fieldName)] !== void 0) return _this["_".concat(fieldName)];
		for (var i = 0; i < _this._rrule.length; i++) {
			var field_1 = _this._rrule[i].origOptions[fieldName];
			if (field_1) return field_1;
		}
	};
}
var RRuleSet = function(_super) {
	__extends(RRuleSet, _super);
	/**
	*
	* @param {Boolean?} noCache
	* The same stratagy as RRule on cache, default to false
	* @constructor
	*/
	function RRuleSet(noCache) {
		if (noCache === void 0) noCache = false;
		var _this = _super.call(this, {}, noCache) || this;
		_this.dtstart = createGetterSetter.apply(_this, ["dtstart"]);
		_this.tzid = createGetterSetter.apply(_this, ["tzid"]);
		_this._rrule = [];
		_this._rdate = [];
		_this._exrule = [];
		_this._exdate = [];
		return _this;
	}
	RRuleSet.prototype._iter = function(iterResult) {
		return iterSet(iterResult, this._rrule, this._exrule, this._rdate, this._exdate, this.tzid());
	};
	/**
	* Adds an RRule to the set
	*
	* @param {RRule}
	*/
	RRuleSet.prototype.rrule = function(rrule) {
		_addRule(rrule, this._rrule);
	};
	/**
	* Adds an EXRULE to the set
	*
	* @param {RRule}
	*/
	RRuleSet.prototype.exrule = function(rrule) {
		_addRule(rrule, this._exrule);
	};
	/**
	* Adds an RDate to the set
	*
	* @param {Date}
	*/
	RRuleSet.prototype.rdate = function(date) {
		_addDate(date, this._rdate);
	};
	/**
	* Adds an EXDATE to the set
	*
	* @param {Date}
	*/
	RRuleSet.prototype.exdate = function(date) {
		_addDate(date, this._exdate);
	};
	/**
	* Get list of included rrules in this recurrence set.
	*
	* @return List of rrules
	*/
	RRuleSet.prototype.rrules = function() {
		return this._rrule.map(function(e) {
			return rrulestr(e.toString());
		});
	};
	/**
	* Get list of excluded rrules in this recurrence set.
	*
	* @return List of exrules
	*/
	RRuleSet.prototype.exrules = function() {
		return this._exrule.map(function(e) {
			return rrulestr(e.toString());
		});
	};
	/**
	* Get list of included datetimes in this recurrence set.
	*
	* @return List of rdates
	*/
	RRuleSet.prototype.rdates = function() {
		return this._rdate.map(function(e) {
			return new Date(e.getTime());
		});
	};
	/**
	* Get list of included datetimes in this recurrence set.
	*
	* @return List of exdates
	*/
	RRuleSet.prototype.exdates = function() {
		return this._exdate.map(function(e) {
			return new Date(e.getTime());
		});
	};
	RRuleSet.prototype.valueOf = function() {
		var result = [];
		if (!this._rrule.length && this._dtstart) result = result.concat(optionsToString({ dtstart: this._dtstart }));
		this._rrule.forEach(function(rrule) {
			result = result.concat(rrule.toString().split("\n"));
		});
		this._exrule.forEach(function(exrule) {
			result = result.concat(exrule.toString().split("\n").map(function(line) {
				return line.replace(/^RRULE:/, "EXRULE:");
			}).filter(function(line) {
				return !/^DTSTART/.test(line);
			}));
		});
		if (this._rdate.length) result.push(rdatesToString("RDATE", this._rdate, this.tzid()));
		if (this._exdate.length) result.push(rdatesToString("EXDATE", this._exdate, this.tzid()));
		return result;
	};
	/**
	* to generate recurrence field such as:
	* DTSTART:19970902T010000Z
	* RRULE:FREQ=YEARLY;COUNT=2;BYDAY=TU
	* RRULE:FREQ=YEARLY;COUNT=1;BYDAY=TH
	*/
	RRuleSet.prototype.toString = function() {
		return this.valueOf().join("\n");
	};
	/**
	* Create a new RRuleSet Object completely base on current instance
	*/
	RRuleSet.prototype.clone = function() {
		var rrs = new RRuleSet(!!this._cache);
		this._rrule.forEach(function(rule) {
			return rrs.rrule(rule.clone());
		});
		this._exrule.forEach(function(rule) {
			return rrs.exrule(rule.clone());
		});
		this._rdate.forEach(function(date) {
			return rrs.rdate(new Date(date.getTime()));
		});
		this._exdate.forEach(function(date) {
			return rrs.exdate(new Date(date.getTime()));
		});
		return rrs;
	};
	return RRuleSet;
}(RRule);
function _addRule(rrule, collection) {
	if (!(rrule instanceof RRule)) throw new TypeError(String(rrule) + " is not RRule instance");
	if (!includes(collection.map(String), String(rrule))) collection.push(rrule);
}
function _addDate(date, collection) {
	if (!(date instanceof Date)) throw new TypeError(String(date) + " is not Date instance");
	if (!includes(collection.map(Number), Number(date))) {
		collection.push(date);
		sort(collection);
	}
}
function rdatesToString(param, rdates, tzid) {
	var isUTC = !tzid || tzid.toUpperCase() === "UTC";
	var header = isUTC ? "".concat(param, ":") : "".concat(param, ";TZID=").concat(tzid, ":");
	var dateString = rdates.map(function(rdate) {
		return timeToUntilString(rdate.valueOf(), isUTC);
	}).join(",");
	return "".concat(header).concat(dateString);
}
//#endregion
//#region src/domain/date.ts
function toDateKey(date) {
	return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function fromDateKey(value) {
	const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
	return new Date(year, month - 1, day);
}
function addDays(date, amount) {
	const next = new Date(date);
	next.setDate(next.getDate() + amount);
	return next;
}
/** Midnight of the same local day. Mirrors `norm()` in the原檔. */
function startOfDay(date) {
	const next = new Date(date);
	next.setHours(0, 0, 0, 0);
	return next;
}
/**
* Whole days from `from` to `to`; negative when `to` is earlier.
*
* Rounded rather than truncated because a local day is 23 or 25 hours long
* across a DST transition, which would otherwise turn one day into zero.
*/
function daysBetween(from, to) {
	return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 864e5);
}
//#endregion
//#region src/domain/eventTime.ts
/**
* A bounded memo for one synchronous expansion, never a shared data cache.
* Exact instants and zones keep the existing DST calculation unchanged.
* The caller owns its lifetime; occurrence results must not retain the reader.
*/
function createZonedPartsReader() {
	const cache = /* @__PURE__ */ new Map();
	return (date, timezone) => {
		const key = `${timezone}\0${date.getTime()}`;
		const cached = cache.get(key);
		if (cached) return cached;
		const parts = zonedParts(date, timezone);
		if (cache.size >= 256) cache.delete(cache.keys().next().value);
		cache.set(key, parts);
		return parts;
	};
}
function wallTimeToInstant(date, time, timezone, readParts = zonedParts) {
	const [year, month, day] = date.split("-").map(Number);
	const [hour, minute] = time.split(":").map(Number);
	const target = Date.UTC(year, month - 1, day, hour, minute);
	let guess = target;
	for (let pass = 0; pass < 2; pass += 1) {
		const parts = readParts(new Date(guess), timezone);
		guess = target - (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - guess);
	}
	return new Date(guess).toISOString();
}
function instantDateInZone(instant, timezone, readParts = zonedParts) {
	const parts = readParts(new Date(instant), timezone);
	return `${String(parts.year).padStart(4, "0")}-${pad$1(parts.month)}-${pad$1(parts.day)}`;
}
function instantTimeInZone(instant, timezone, readParts = zonedParts) {
	const parts = readParts(new Date(instant), timezone);
	return `${pad$1(parts.hour)}:${pad$1(parts.minute)}`;
}
/**
* One formatter per zone.
*
* Constructing an `Intl.DateTimeFormat` is orders of magnitude more expensive
* than using one, and DP-081 made this the inner loop: every occurrence of a
* recurring event resolves its wall time through here, so a year of an hourly
* series built thousands of formatters and took seconds. The formatters are
* immutable and depend only on the zone, so they are shared.
*/
var zoneFormatters = /* @__PURE__ */ new Map();
function zoneFormatter(timezone) {
	const cached = zoneFormatters.get(timezone);
	if (cached) return cached;
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23"
	});
	zoneFormatters.set(timezone, formatter);
	return formatter;
}
function zonedParts(date, timezone) {
	const result = {};
	const parts = zoneFormatter(timezone).formatToParts(date);
	for (const part of parts) if (part.type !== "literal") result[part.type] = Number(part.value);
	return {
		year: result.year,
		month: result.month,
		day: result.day,
		hour: result.hour,
		minute: result.minute
	};
}
function pad$1(value) {
	return String(value).padStart(2, "0");
}
//#endregion
//#region src/domain/recurrence.ts
var DATE_UNTIL = /^\d{8}$/;
var UTC_DATE_TIME_UNTIL = /^\d{8}T\d{6}Z$/;
var POSITIVE_INTEGER = /^[1-9]\d*$/;
var ALL_DAY_TIME_PARTS = /* @__PURE__ */ new Set([
	"BYHOUR",
	"BYMINUTE",
	"BYSECOND"
]);
var MAX_OCCURRENCES_PER_WINDOW = 1e4;
var RecurrenceRuleError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "RecurrenceRuleError";
	}
};
/**
* Parse the RFC 5545 RECUR value stored by DayPop.
*
* DTSTART and TZID belong to the event, not the RRULE column. Keeping them out
* of the stored text lets all-day and timed events share one DB field while
* expansion can still anchor the rule to the event's canonical start.
*/
function parseRecurrenceRule(rule, allDay) {
	const canonical = rule.trim().toUpperCase();
	if (!canonical || canonical.includes("\n") || canonical.startsWith("RRULE:")) throw new RecurrenceRuleError("recurrence rule must contain only the RECUR value");
	const parts = /* @__PURE__ */ new Map();
	for (const part of canonical.split(";")) {
		const separator = part.indexOf("=");
		if (separator <= 0 || separator === part.length - 1) throw new RecurrenceRuleError("recurrence rule contains an invalid rule part");
		const name = part.slice(0, separator);
		const value = part.slice(separator + 1);
		if (parts.has(name)) throw new RecurrenceRuleError(`recurrence rule repeats ${name}`);
		parts.set(name, value);
	}
	if (!parts.has("FREQ")) throw new RecurrenceRuleError("recurrence rule requires FREQ");
	if (parts.has("COUNT") && parts.has("UNTIL")) throw new RecurrenceRuleError("recurrence rule cannot contain both COUNT and UNTIL");
	for (const name of ["COUNT", "INTERVAL"]) {
		const value = parts.get(name);
		if (value !== void 0 && !POSITIVE_INTEGER.test(value)) throw new RecurrenceRuleError(`${name} must be a positive integer`);
	}
	const until = parts.get("UNTIL");
	if (until !== void 0) {
		if (!(allDay ? DATE_UNTIL.test(until) : UTC_DATE_TIME_UNTIL.test(until))) throw new RecurrenceRuleError(allDay ? "all-day UNTIL must be an RFC 5545 DATE" : "timed UNTIL must be an RFC 5545 UTC DATE-TIME");
	}
	if (allDay) {
		for (const name of ALL_DAY_TIME_PARTS) if (parts.has(name)) throw new RecurrenceRuleError(`${name} is not valid for an all-day DTSTART`);
	}
	try {
		return {
			canonical,
			options: RRule.parseString(canonical),
			until
		};
	} catch (error) {
		throw new RecurrenceRuleError(error instanceof Error ? error.message : "recurrence rule is invalid");
	}
}
function isRecurrenceRule(rule, allDay) {
	if (typeof rule !== "string" || rule.trim() !== rule) return false;
	try {
		parseRecurrenceRule(rule, allDay);
		return true;
	} catch {
		return false;
	}
}
/**
* Resolve base events plus exception rows into concrete occurrences.
*
* RRule generates calendar fields in a floating UTC frame. Timed results are
* then resolved through DayPop's wall-time boundary. This deliberately avoids
* adding fixed milliseconds: a daily 09:00 stays 09:00 when DST changes.
*/
function resolveEventOccurrences(data, window) {
	if (window.endDate < window.startDate) throw new RangeError("occurrence window endDate must be on or after startDate");
	const readParts = createZonedPartsReader();
	const eventsById = new Map(data.events.map((event) => [event.id, event]));
	const replacementIds = new Set(data.eventExceptions.map((exception) => exception.replacementEventId).filter((id) => id !== null));
	const exceptionsByEvent = groupExceptions(data.eventExceptions);
	const includedReplacements = /* @__PURE__ */ new Set();
	const resolved = [];
	for (const event of data.events) {
		if (replacementIds.has(event.id)) continue;
		if (event.recurrence === null) {
			if (eventOverlapsWindow(event, window, readParts)) {
				const occurrence = eventOccurrence(event);
				resolved.push(toResolved(event.id, occurrence, event, null));
			}
			continue;
		}
		for (const shifted of expandBaseEvent(event, window, readParts)) {
			const occurrence = eventOccurrence(shifted);
			const exception = exceptionsByEvent.get(event.id)?.get(eventOccurrenceKey(occurrence));
			if (exception?.isCancelled) continue;
			if (exception && exception.replacementEventId !== null) {
				const replacement = eventsById.get(exception.replacementEventId);
				if (replacement && eventOverlapsWindow(replacement, window, readParts)) {
					resolved.push(toResolved(event.id, occurrence, replacement, exception.replacementEventId));
					includedReplacements.add(exception.replacementEventId);
				}
			} else if (eventOverlapsWindow(shifted, window, readParts)) resolved.push(toResolved(event.id, occurrence, shifted, null));
		}
	}
	for (const exception of data.eventExceptions) {
		if (exception.isCancelled || includedReplacements.has(exception.replacementEventId)) continue;
		const replacement = eventsById.get(exception.replacementEventId);
		if (replacement && eventOverlapsWindow(replacement, window, readParts)) {
			resolved.push(toResolved(exception.eventId, exception.occurrence, replacement, exception.replacementEventId));
			includedReplacements.add(exception.replacementEventId);
		}
	}
	return resolved.sort(compareOccurrences);
}
/**
* The floating calendar dates a rule generates inside `window`.
*
* Split out of `expandBaseEvent()` so the import probe can count what a rule
* produces without paying for `shiftEvent()` on every candidate — resolving
* wall times is what made a year-wide probe take tens of seconds.
*/
function recurrenceCandidates(event, window, readParts) {
	const startDate = event.allDay ? event.startDate : instantDateInZone(event.startsAt, event.timezone, readParts);
	const startTime = event.allDay ? "00:00" : instantTimeInZone(event.startsAt, event.timezone, readParts);
	const endDate = event.allDay ? event.endDate : instantDateInZone(event.endsAt, event.timezone, readParts);
	const spanDays = daysBetween(fromDateKey(startDate), fromDateKey(endDate));
	const parsed = parseRecurrenceRule(event.recurrence.rule, event.allDay);
	const rule = new RRule({
		...parsed.options,
		dtstart: floatingDate(startDate, startTime),
		until: event.allDay ? parsed.options.until : null
	});
	const lookBehind = toDateKey(addDays(fromDateKey(window.startDate), -Math.max(0, spanDays)));
	const after = floatingDate(lookBehind < startDate ? startDate : lookBehind, "00:00");
	const before = floatingDate(toDateKey(addDays(fromDateKey(window.endDate), 1)), "00:00");
	const candidates = rule.between(after, before, true, (_candidate, length) => length <= MAX_OCCURRENCES_PER_WINDOW);
	if (candidates.length > MAX_OCCURRENCES_PER_WINDOW) throw new RecurrenceRuleError("recurrence rule produces too many occurrences in this window");
	return candidates;
}
function* expandBaseEvent(event, window, readParts) {
	if (event.recurrence === null) {
		yield event;
		return;
	}
	const startDate = event.allDay ? event.startDate : instantDateInZone(event.startsAt, event.timezone, readParts);
	const startTime = event.allDay ? "00:00" : instantTimeInZone(event.startsAt, event.timezone, readParts);
	const endDate = event.allDay ? event.endDate : instantDateInZone(event.endsAt, event.timezone, readParts);
	const endTime = event.allDay ? "00:00" : instantTimeInZone(event.endsAt, event.timezone, readParts);
	const spanDays = daysBetween(fromDateKey(startDate), fromDateKey(endDate));
	const parsed = parseRecurrenceRule(event.recurrence.rule, event.allDay);
	const actualUntil = !event.allDay && parsed.until ? parseBasicUtcDateTime(parsed.until).getTime() : null;
	const candidates = recurrenceCandidates(event, window, readParts);
	for (const candidate of candidates) {
		const shifted = shiftEvent(event, floatingDateKey(candidate), startTime, endTime, spanDays, readParts);
		if (shifted && (actualUntil === null || shifted.allDay || Date.parse(shifted.startsAt) <= actualUntil)) yield shifted;
	}
}
function shiftEvent(event, candidateDate, startTime, endTime, spanDays, readParts) {
	if (event.allDay) return {
		...event,
		startDate: candidateDate,
		endDate: toDateKey(addDays(fromDateKey(candidateDate), spanDays))
	};
	const startsAt = wallTimeToInstant(candidateDate, startTime, event.timezone, readParts);
	if (instantDateInZone(startsAt, event.timezone, readParts) !== candidateDate || instantTimeInZone(startsAt, event.timezone, readParts) !== startTime) return null;
	const endsAt = wallTimeToInstant(toDateKey(addDays(fromDateKey(candidateDate), spanDays)), endTime, event.timezone, readParts);
	return {
		...event,
		startsAt,
		endsAt
	};
}
function eventOverlapsWindow(event, window, readParts) {
	const start = event.allDay ? event.startDate : instantDateInZone(event.startsAt, event.timezone, readParts);
	const end = event.allDay ? event.endDate : instantDateInZone(event.endsAt, event.timezone, readParts);
	return start <= window.endDate && end >= window.startDate;
}
function eventOccurrence(event) {
	return event.allDay ? {
		kind: "all-day",
		date: event.startDate
	} : {
		kind: "timed",
		startsAt: event.startsAt
	};
}
function groupExceptions(exceptions) {
	const grouped = /* @__PURE__ */ new Map();
	for (const exception of exceptions) {
		const byOccurrence = grouped.get(exception.eventId) ?? /* @__PURE__ */ new Map();
		byOccurrence.set(eventOccurrenceKey(exception.occurrence), exception);
		grouped.set(exception.eventId, byOccurrence);
	}
	return grouped;
}
function toResolved(sourceEventId, occurrence, event, replacementEventId) {
	return {
		key: `${sourceEventId}:${eventOccurrenceKey(occurrence)}`,
		sourceEventId,
		occurrence,
		event,
		replacementEventId
	};
}
function compareOccurrences(left, right) {
	const leftStart = left.event.allDay ? left.event.startDate : left.event.startsAt;
	const rightStart = right.event.allDay ? right.event.startDate : right.event.startsAt;
	return leftStart.localeCompare(rightStart) || left.key.localeCompare(right.key);
}
function floatingDate(date, time) {
	const [year, month, day] = date.split("-").map(Number);
	const [hour, minute] = time.split(":").map(Number);
	return new Date(Date.UTC(year, month - 1, day, hour, minute));
}
function floatingDateKey(date) {
	return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function parseBasicUtcDateTime(value) {
	return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), Number(value.slice(9, 11)), Number(value.slice(11, 13)), Number(value.slice(13, 15))));
}
function pad(value) {
	return String(value).padStart(2, "0");
}
function isTitleTooLong(title) {
	return Array.from(title.trim()).length > 300;
}
var MAX_REMINDER_MINUTES = 10080;
var DomainValidationError = class extends Error {
	issues;
	constructor(issues) {
		super(`DayPop domain validation failed: ${issues.join("; ")}`);
		this.issues = issues;
		this.name = "DomainValidationError";
	}
};
function isDateKey(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
/** Requires an explicit UTC marker or numeric offset; local datetime strings are rejected. */
function isIsoInstant(value) {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function isIanaTimezone(value) {
	if (typeof value !== "string" || value.trim() !== value || value === "") return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
		return true;
	} catch {
		return false;
	}
}
function parseCalendarEvent(value) {
	return parseEntity(value, "event", validateEvent);
}
function parseEventException(value) {
	return parseEntity(value, "eventException", validateEventException);
}
function parseTodo(value) {
	return parseEntity(value, "todo", validateTodo);
}
function validateEvent(value, path, issues, allowLegacyTitle = false) {
	if (!isRecord(value)) return invalidObject(path, issues);
	let valid = validateId(value.id, `${path}.id`, issues) && validateId(value.calendarId, `${path}.calendarId`, issues) && validateTitle(value.title, `${path}.title`, issues, allowLegacyTitle) && validateNullableString(value.location, `${path}.location`, issues) && validateNullableString(value.notes, `${path}.notes`, issues) && validateReminderMinutes(value.reminderMinutes, `${path}.reminderMinutes`, issues) && validateEnum(value.sharingScope, ["inherit", "private"], `${path}.sharingScope`, issues) && validateInstant(value.createdAt, `${path}.createdAt`, issues) && validateInstant(value.updatedAt, `${path}.updatedAt`, issues);
	if (value.allDay === true) {
		valid = validateRecurrence(value.recurrence, `${path}.recurrence`, issues, true) && valid;
		valid = validateDate(value.startDate, `${path}.startDate`, issues) && valid;
		valid = validateDate(value.endDate, `${path}.endDate`, issues) && valid;
		if (hasDefined(value, [
			"startsAt",
			"endsAt",
			"timezone"
		])) {
			issues.push(`${path} all-day shape cannot contain timed fields`);
			valid = false;
		}
		if (isDateKey(value.startDate) && isDateKey(value.endDate) && value.endDate < value.startDate) {
			issues.push(`${path}.endDate must be on or after startDate`);
			valid = false;
		}
	} else if (value.allDay === false) {
		valid = validateRecurrence(value.recurrence, `${path}.recurrence`, issues, false) && valid;
		valid = validateInstant(value.startsAt, `${path}.startsAt`, issues) && valid;
		valid = validateInstant(value.endsAt, `${path}.endsAt`, issues) && valid;
		valid = validateTimezone(value.timezone, `${path}.timezone`, issues) && valid;
		if (hasDefined(value, ["startDate", "endDate"])) {
			issues.push(`${path} timed shape cannot contain all-day fields`);
			valid = false;
		}
		if (isIsoInstant(value.startsAt) && isIsoInstant(value.endsAt) && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
			issues.push(`${path}.endsAt must be later than startsAt`);
			valid = false;
		}
	} else {
		issues.push(`${path}.allDay must be a boolean discriminator`);
		valid = false;
	}
	return valid ? value : null;
}
function validateEventException(value, path, issues) {
	if (!isRecord(value)) return invalidObject(path, issues);
	let valid = validateId(value.id, `${path}.id`, issues) && validateId(value.eventId, `${path}.eventId`, issues) && validateInstant(value.createdAt, `${path}.createdAt`, issues) && validateInstant(value.updatedAt, `${path}.updatedAt`, issues);
	if (!isRecord(value.occurrence)) {
		issues.push(`${path}.occurrence must be an object`);
		valid = false;
	} else if (value.occurrence.kind === "all-day") valid = validateDate(value.occurrence.date, `${path}.occurrence.date`, issues) && valid;
	else if (value.occurrence.kind === "timed") valid = validateInstant(value.occurrence.startsAt, `${path}.occurrence.startsAt`, issues) && valid;
	else {
		issues.push(`${path}.occurrence.kind is invalid`);
		valid = false;
	}
	if (value.isCancelled === true) {
		if (value.replacementEventId !== null) {
			issues.push(`${path}.replacementEventId must be null when cancelled`);
			valid = false;
		}
	} else if (value.isCancelled === false) {
		valid = validateId(value.replacementEventId, `${path}.replacementEventId`, issues) && valid;
		if (value.replacementEventId === value.eventId) {
			issues.push(`${path}.replacementEventId cannot equal eventId`);
			valid = false;
		}
	} else {
		issues.push(`${path}.isCancelled must be boolean`);
		valid = false;
	}
	return valid ? value : null;
}
function validateTodo(value, path, issues, allowLegacyTitle = false) {
	if (!isRecord(value)) return invalidObject(path, issues);
	let valid = validateId(value.id, `${path}.id`, issues) && validateId(value.calendarId, `${path}.calendarId`, issues) && validateNullableId(value.parentId, `${path}.parentId`, issues) && validateTitle(value.title, `${path}.title`, issues, allowLegacyTitle) && validateNullableDate(value.dueDate, `${path}.dueDate`, issues) && validateEnum(value.priority, [
		"none",
		"low",
		"medium",
		"high"
	], `${path}.priority`, issues) && validateNullableInstant(value.completedAt, `${path}.completedAt`, issues) && validateNonnegativeInteger(value.sortOrder, `${path}.sortOrder`, issues) && validateEnum(value.sharingScope, ["inherit", "private"], `${path}.sharingScope`, issues) && validateInstant(value.createdAt, `${path}.createdAt`, issues) && validateInstant(value.updatedAt, `${path}.updatedAt`, issues);
	if (value.parentId === value.id) {
		issues.push(`${path}.parentId cannot equal id`);
		valid = false;
	}
	return valid ? value : null;
}
function parseEntity(value, path, validate) {
	const issues = [];
	const parsed = validate(value, path, issues);
	if (!parsed) throw new DomainValidationError(issues);
	return parsed;
}
function validateId(value, path, issues) {
	if (isUuid(value)) return true;
	issues.push(`${path} must be a UUID`);
	return false;
}
function isUuid(value) {
	return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function validateNullableId(value, path, issues) {
	return value === null || validateId(value, path, issues);
}
function validateTrimmedString(value, path, issues) {
	if (typeof value === "string" && value.length > 0 && value.trim() === value) return true;
	issues.push(`${path} must be a non-empty trimmed string`);
	return false;
}
function validateTitle(value, path, issues, allowLegacyTitle) {
	if (!validateTrimmedString(value, path, issues)) return false;
	if (!allowLegacyTitle && isTitleTooLong(value)) {
		issues.push(`${path} must contain at most 300 Unicode characters`);
		return false;
	}
	return true;
}
function validateNullableString(value, path, issues) {
	if (value === null || typeof value === "string") return true;
	issues.push(`${path} must be a string or null`);
	return false;
}
function validateNonnegativeInteger(value, path, issues) {
	if (Number.isInteger(value) && Number(value) >= 0) return true;
	issues.push(`${path} must be a nonnegative integer`);
	return false;
}
function validateReminderMinutes(value, path, issues) {
	if (!Array.isArray(value)) {
		issues.push(`${path} must be an array`);
		return false;
	}
	let valid = true;
	if (value.length > 10) {
		issues.push(`${path} must contain at most 10 reminders`);
		valid = false;
	}
	if (!value.every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 10080)) {
		issues.push(`${path} minutes must be integers between 0 and ${MAX_REMINDER_MINUTES}`);
		valid = false;
	}
	return valid;
}
function validateEnum(value, choices, path, issues) {
	if (choices.includes(value)) return true;
	issues.push(`${path} must be one of ${choices.join(", ")}`);
	return false;
}
function validateDate(value, path, issues) {
	if (isDateKey(value)) return true;
	issues.push(`${path} must be a valid YYYY-MM-DD date`);
	return false;
}
function validateNullableDate(value, path, issues) {
	return value === null || validateDate(value, path, issues);
}
function validateInstant(value, path, issues) {
	if (isIsoInstant(value)) return true;
	issues.push(`${path} must be an ISO instant with Z or a numeric offset`);
	return false;
}
function validateNullableInstant(value, path, issues) {
	return value === null || validateInstant(value, path, issues);
}
function validateTimezone(value, path, issues) {
	if (isIanaTimezone(value)) return true;
	issues.push(`${path} must be a supported IANA timezone`);
	return false;
}
function validateRecurrence(value, path, issues, allDay) {
	if (value === null) return true;
	if (isRecord(value) && isRecurrenceRule(value.rule, allDay)) return true;
	if (isRecord(value)) issues.push(`${path}.rule must be a valid RFC 5545 recurrence rule`);
	if (!isRecord(value)) issues.push(`${path} must be an object or null`);
	return false;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasDefined(value, keys) {
	return keys.some((key) => value[key] !== void 0);
}
function invalidObject(path, issues) {
	issues.push(`${path} must be an object`);
	return null;
}
//#endregion
//#region src/reminders/schedule.ts
var REMINDER_LIFETIME_MS = 3e5;
var DAY_MS = 864e5;
var MAX_JOBS_PER_CALENDAR = 1e3;
var MAX_DATE = Date.parse("9999-12-31T23:59:59.999Z");
var MIN_DATE = Date.parse("0100-01-01T00:00:00.000Z");
function isCalendarReminderRule(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const rule = value;
	return typeof rule.calendarId === "string" && rule.calendarId.length > 0 && Array.isArray(rule.minutesBefore) && rule.minutesBefore.length <= 10 && rule.minutesBefore.every((offset) => typeof offset === "number" && Number.isInteger(offset) && offset >= 0 && offset <= 10080) && isIanaTimezone(rule.timezone) && typeof rule.dateTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.dateTime) && typeof rule.includeTodos === "boolean" && isIsoInstant(rule.updatedAt);
}
/**
* Server-side pure planning. The caller MUST supply a freshly authorized
* recipient snapshot, then revalidate permissions/versions before sending.
* No titles, locations, notes, account data or push endpoints leave this seam.
* Legacy event.reminderMinutes is preserved but does not silently opt in users.
*/
function planReminders(snapshot, rules, now) {
	if (!isIsoInstant(now)) throw new RangeError("reminder clock must be an explicit instant");
	if (new Set(rules.map((rule) => rule.calendarId)).size !== rules.length) throw new RangeError("duplicate calendar reminder rules");
	const clock = Date.parse(now);
	if (clock < MIN_DATE || clock > MAX_DATE) throw new RangeError("reminder clock outside supported dates");
	const window = {
		startDate: new Date(Math.max(MIN_DATE, clock - 2 * DAY_MS)).toISOString().slice(0, 10),
		endDate: new Date(Math.min(MAX_DATE, clock + 9 * DAY_MS)).toISOString().slice(0, 10)
	};
	const result = {
		jobs: [],
		issues: []
	};
	const byId = new Map(snapshot.events.map((event) => [event.id, event]));
	const neighbours = /* @__PURE__ */ new Map();
	for (const exception of snapshot.eventExceptions) {
		if (exception.replacementEventId === null) continue;
		for (const [from, to] of [[exception.eventId, exception.replacementEventId], [exception.replacementEventId, exception.eventId]]) {
			const linked = neighbours.get(from) ?? [];
			linked.push(to);
			neighbours.set(from, linked);
		}
	}
	for (const rule of rules) {
		const calendarId = rule.calendarId;
		if (!isCalendarReminderRule(rule)) {
			result.issues.push({
				calendarId,
				code: "invalid-rule"
			});
			continue;
		}
		if (rule.minutesBefore.length === 0) continue;
		const offsets = [...new Set(rule.minutesBefore)];
		const calendarJobs = /* @__PURE__ */ new Map();
		const consentAt = Date.parse(rule.updatedAt);
		function add(kind, sourceId, effectiveEventId, occurrence, startsAt, sourceUpdatedAt, effectiveUpdatedAt, createdAt) {
			if (startsAt === null) return;
			const start = Date.parse(startsAt);
			for (const minutesBefore of offsets) {
				const fire = start - minutesBefore * 6e4;
				if (fire > clock || clock >= fire + 3e5 || fire < consentAt || fire < Date.parse(createdAt)) continue;
				const fireAt = new Date(fire).toISOString();
				const key = JSON.stringify([
					kind,
					rule.calendarId,
					sourceId,
					eventOccurrenceKey(occurrence),
					fireAt,
					minutesBefore
				]);
				calendarJobs.set(key, {
					key,
					calendarId: rule.calendarId,
					sourceKind: kind,
					sourceId,
					effectiveEventId,
					occurrence,
					minutesBefore,
					fireAt,
					expiresAt: new Date(fire + REMINDER_LIFETIME_MS).toISOString(),
					sourceUpdatedAt,
					effectiveUpdatedAt,
					ruleUpdatedAt: rule.updatedAt
				});
				if (calendarJobs.size > MAX_JOBS_PER_CALENDAR) throw new RangeError("reminder capacity exceeded");
			}
		}
		try {
			const pending = snapshot.events.filter((event) => event.calendarId === rule.calendarId).map((event) => event.id);
			const relevant = new Set(pending);
			while (pending.length > 0) for (const id of neighbours.get(pending.pop()) ?? []) if (!relevant.has(id)) {
				relevant.add(id);
				pending.push(id);
			}
			const occurrences = resolveEventOccurrences({
				events: snapshot.events.filter((event) => relevant.has(event.id)),
				eventExceptions: snapshot.eventExceptions.filter((exception) => relevant.has(exception.eventId))
			}, window);
			for (const resolved of occurrences) {
				if (resolved.event.calendarId !== rule.calendarId) continue;
				const source = byId.get(resolved.sourceEventId);
				if (!source) throw new RangeError("missing reminder series");
				const event = resolved.event;
				const start = event.allDay ? dateAlarm(event.startDate, rule) : event.startsAt;
				add("event", source.id, event.id, resolved.occurrence, start, source.updatedAt, event.updatedAt, event.createdAt);
			}
			if (rule.includeTodos) for (const item of snapshot.todos) {
				if (item.calendarId !== rule.calendarId || item.completedAt !== null || item.dueDate === null) continue;
				add("todo", item.id, null, {
					kind: "all-day",
					date: item.dueDate
				}, dateAlarm(item.dueDate, rule), item.updatedAt, item.updatedAt, item.createdAt);
			}
			result.jobs.push(...calendarJobs.values());
		} catch {
			result.issues.push({
				calendarId: rule.calendarId,
				code: "schedule-unavailable"
			});
		}
	}
	result.jobs.sort((a, b) => a.fireAt.localeCompare(b.fireAt) || a.key.localeCompare(b.key));
	return result;
}
function dateAlarm(date, rule) {
	if (!isDateKey(date)) throw new RangeError("invalid reminder date");
	const instant = wallTimeToInstant(date, rule.dateTime, rule.timezone);
	return instantDateInZone(instant, rule.timezone) === date && instantTimeInZone(instant, rule.timezone) === rule.dateTime ? instant : null;
}
//#endregion
//#region src/reminders/delivery.ts
var record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var HASH = /^[a-f0-9]{64}$/;
var KEY = /^B[A-Za-z0-9_-]{86}$/;
var AUTH = /^[A-Za-z0-9_-]{22}$/;
function isAllowedPushEndpoint(value) {
	return typeof value === "string" && value.length >= 20 && value.length <= 2048 && value.trim() === value && Array.from(value).every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127) && /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/[^#\s]+$/.test(value);
}
async function reminderJobHash(key) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Server-only adapter. This module creates no client and reads no credentials. */
function createReminderStore(client, publicKey) {
	if (publicKey.length !== 87 || !KEY.test(publicKey)) throw new Error("reminder_invalid_public_key");
	async function checked(result) {
		const response = await result;
		if (response.error) throw new Error("reminder_store_unavailable");
		return response.data;
	}
	const signal = () => AbortSignal.timeout(1e4);
	return {
		page: (after) => checked(client.rpc("reminder_sender_page", after === null ? {} : { p_after: after }).abortSignal(signal())),
		context: (deviceId, calendarId) => checked(client.rpc("reminder_sender_context", {
			p_device_id: deviceId,
			p_calendar_id: calendarId
		}).abortSignal(signal())),
		claim: (deviceId, calendarId, version, hash, fireAt) => checked(client.rpc("claim_reminder_delivery", {
			p_public_key: publicKey,
			p_device_id: deviceId,
			p_calendar_id: calendarId,
			p_version: version,
			p_job_hash: hash,
			p_fire_at: fireAt
		}).abortSignal(signal())),
		finish: async (deviceId, hash, leaseId, result) => {
			await checked(client.rpc("finish_reminder_delivery", {
				p_device_id: deviceId,
				p_job_hash: hash,
				p_lease_id: leaseId,
				p_result: result
			}).abortSignal(signal()));
		},
		heartbeat: async (error) => {
			await checked(client.rpc("reminder_sender_heartbeat", error === null ? { p_public_key: publicKey } : {
				p_public_key: publicKey,
				p_error: error
			}).abortSignal(signal()));
		}
	};
}
function readPage(value, after) {
	if (!Array.isArray(value) || value.length > 100) throw Error("invalid_page");
	let previous = after ?? "";
	return value.map((row) => {
		if (!record(row) || !isUuid(row.deviceId) || row.deviceId <= previous || !Array.isArray(row.calendarIds) || row.calendarIds.length > 200 || !row.calendarIds.every(isUuid) || new Set(row.calendarIds).size !== row.calendarIds.length) throw Error("invalid_page");
		previous = row.deviceId;
		return {
			deviceId: row.deviceId,
			calendarIds: row.calendarIds
		};
	});
}
function readContext(value, calendarId) {
	if (!record(value) || typeof value.version !== "string" || value.version.length !== 64 || !HASH.test(value.version) || !isIsoInstant(value.deviceCreatedAt) || !isCalendarReminderRule(value.rule) || value.rule.calendarId !== calendarId || !record(value.snapshot)) throw Error("invalid_context");
	const raw = value.snapshot;
	if (!Array.isArray(raw.events) || raw.events.length > 5e3 || !Array.isArray(raw.eventExceptions) || raw.eventExceptions.length > 1e4 || !Array.isArray(raw.todos) || raw.todos.length > 5e3) throw Error("invalid_context");
	const snapshot = {
		events: raw.events.map(parseCalendarEvent),
		eventExceptions: raw.eventExceptions.map(parseEventException),
		todos: raw.todos.map(parseTodo)
	};
	for (const rows of [
		snapshot.events,
		snapshot.eventExceptions,
		snapshot.todos
	]) if (new Set(rows.map((row) => row.id)).size !== rows.length) throw Error("invalid_context");
	const events = new Map(snapshot.events.map((row) => [row.id, row]));
	const occurrenceKeys = /* @__PURE__ */ new Set();
	for (const exception of snapshot.eventExceptions) {
		const source = events.get(exception.eventId), replacement = exception.replacementEventId === null ? null : events.get(exception.replacementEventId);
		if (!source?.recurrence || exception.occurrence.kind !== (source.allDay ? "all-day" : "timed") || exception.replacementEventId !== null && (!replacement || replacement.recurrence !== null)) throw Error("invalid_context");
		const key = exception.eventId + ":" + eventOccurrenceKey(exception.occurrence);
		if (occurrenceKeys.has(key)) throw Error("invalid_context");
		occurrenceKeys.add(key);
	}
	const todos = new Map(snapshot.todos.map((row) => [row.id, row]));
	const checked = /* @__PURE__ */ new Set();
	for (const todo of snapshot.todos) {
		const seen = /* @__PURE__ */ new Set();
		let current = todo;
		while (!checked.has(current.id)) {
			if (seen.has(current.id)) throw Error("invalid_context");
			seen.add(current.id);
			if (current.parentId === null) break;
			const parent = todos.get(current.parentId);
			if (!parent || parent.calendarId !== current.calendarId) throw Error("invalid_context");
			current = parent;
		}
		for (const id of seen) checked.add(id);
	}
	return {
		snapshot,
		version: value.version,
		rule: value.rule,
		deviceCreatedAt: value.deviceCreatedAt
	};
}
function readLease(value, job) {
	if (!record(value) || !isUuid(value.leaseId) || !isAllowedPushEndpoint(value.endpoint) || typeof value.p256dh !== "string" || value.p256dh.length !== 87 || !KEY.test(value.p256dh) || typeof value.auth !== "string" || value.auth.length !== 22 || !AUTH.test(value.auth) || !isIsoInstant(value.expiresAt) || Date.parse(value.expiresAt) !== Date.parse(job.expiresAt)) throw Error("invalid_lease");
	return {
		leaseId: value.leaseId,
		subscription: {
			endpoint: value.endpoint,
			p256dh: value.p256dh,
			auth: value.auth
		}
	};
}
/** No timers/retries invent new jobs: the DB owns every lease and retry budget. */
async function runReminderTick(options) {
	const { store, transport, clock = Date.now, budgetMs = 45e3, maxDevices = 1e4 } = options;
	if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 12e4 || !Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 1e4) throw Error("reminder_invalid_limits");
	const started = clock();
	function time() {
		const now = clock();
		if (!Number.isFinite(now) || now < started || !isIsoInstant(new Date(now).toISOString())) throw Error("reminder_clock_unavailable");
		return now;
	}
	const summary = {
		devices: 0,
		calendars: 0,
		sent: 0,
		retry: 0,
		failed: 0,
		gone: 0,
		skipped: 0,
		unconfirmed: 0,
		issues: []
	};
	const issues = /* @__PURE__ */ new Set();
	const expiredBudget = () => time() - started >= budgetMs;
	let after = null;
	try {
		outer: for (;;) {
			if (expiredBudget()) {
				issues.add("capacity");
				break;
			}
			const page = readPage(await store.page(after), after);
			for (const device of page) {
				if (expiredBudget() || summary.devices >= maxDevices) {
					issues.add("capacity");
					break outer;
				}
				summary.devices++;
				for (const calendarId of device.calendarIds) {
					if (expiredBudget()) {
						issues.add("capacity");
						break outer;
					}
					summary.calendars++;
					let context;
					try {
						const value = await store.context(device.deviceId, calendarId);
						if (value === null) {
							summary.skipped++;
							continue;
						}
						context = readContext(value, calendarId);
					} catch {
						issues.add("planning");
						continue;
					}
					const plan = planReminders(context.snapshot, [context.rule], new Date(time()).toISOString());
					if (plan.issues.length) {
						issues.add("planning");
						continue;
					}
					for (const job of plan.jobs) {
						if (expiredBudget()) {
							issues.add("capacity");
							break outer;
						}
						if (Date.parse(job.fireAt) < Date.parse(context.deviceCreatedAt) || time() >= Date.parse(job.expiresAt)) {
							summary.skipped++;
							continue;
						}
						const hash = await reminderJobHash(job.key);
						const value = await store.claim(device.deviceId, calendarId, context.version, hash, job.fireAt);
						if (value === null) {
							summary.skipped++;
							continue;
						}
						const lease = readLease(value, job);
						const remaining = Date.parse(job.expiresAt) - time();
						const budgetRemaining = started + budgetMs - time();
						let result = "failed";
						if (remaining < 1e3 || budgetRemaining < 1) {
							summary.skipped++;
							result = remaining < 1e3 ? "failed" : "retry";
							if (budgetRemaining < 1) issues.add("capacity");
						} else {
							try {
								const status = await transport.send(lease.subscription, {
									payload: JSON.stringify({
										v: 1,
										tag: hash
									}),
									tag: hash,
									ttl: Math.floor(remaining / 1e3),
									expiresAt: job.expiresAt,
									signal: AbortSignal.timeout(Math.min(1e4, Math.floor(remaining), Math.floor(budgetRemaining)))
								});
								result = !Number.isInteger(status) ? "failed" : status >= 200 && status < 300 ? "sent" : status === 404 || status === 410 ? "gone" : status === 408 || status === 429 || status >= 500 && status <= 599 ? "retry" : "failed";
							} catch {
								result = "retry";
							}
							if (result === "retry" || result === "failed") issues.add("transport");
						}
						try {
							await store.finish(device.deviceId, hash, lease.leaseId, result);
							summary[result]++;
						} catch {
							summary.unconfirmed++;
							issues.add("transport");
						}
					}
				}
			}
			if (page.length < 100) break;
			after = page[page.length - 1].deviceId;
		}
	} catch {
		issues.add("transport");
	}
	summary.issues = [...issues].sort();
	try {
		await store.heartbeat(summary.issues[0] ?? null);
	} catch {
		if (!issues.has("transport")) summary.issues.push("transport");
	}
	return summary;
}
/** Request authentication precedes construction of a privileged client/runner. */
function createReminderTickHandler(secret, createOptions) {
	const json = (body, status) => new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store"
		}
	});
	return async (request) => {
		if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
		if (!secret || !/^[A-Za-z0-9_-]{43,256}$/.test(secret)) return json({ error: "reminder_unavailable" }, 503);
		const supplied = request.headers.get("Authorization");
		if (!supplied || !/^Bearer [A-Za-z0-9_-]{43,256}$/.test(supplied)) return json({ error: "unauthorized" }, 401);
		try {
			const [expected, actual] = await Promise.all([reminderJobHash(secret), reminderJobHash(supplied.slice(7))]);
			let difference = 0;
			for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
			if (difference !== 0) return json({ error: "unauthorized" }, 401);
			const text = await request.text();
			if (text.length > 64) return json({ error: "invalid_request" }, 400);
			if (text.trim()) {
				let body;
				try {
					body = JSON.parse(text);
				} catch {
					return json({ error: "invalid_request" }, 400);
				}
				if (!record(body) || Object.keys(body).length) return json({ error: "invalid_request" }, 400);
			}
			const result = await runReminderTick(await createOptions());
			return json(result, result.issues.length ? 503 : 200);
		} catch {
			return json({ error: "reminder_unavailable" }, 503);
		}
	};
}
//#endregion
//#region src/lib/supabaseKey.ts
var PUBLISHABLE_PREFIX = "sb_publishable_";
var SECRET_PREFIX = "sb_secret_";
function classifySupabaseKey(value) {
	const key = value?.trim() ?? "";
	if (key === "") return "unknown";
	if (key.startsWith(PUBLISHABLE_PREFIX)) return "publishable";
	if (key.startsWith(SECRET_PREFIX)) return "secret";
	const role = readJwtRole(key);
	if (role === "anon") return "anon-jwt";
	if (role === "service_role") return "service-role-jwt";
	return "unknown";
}
/**
* Reads `role` out of a JWT payload, or `null` if the value is not a JWT this
* module can read. Any failure returns `null`, which the caller treats as
* `unknown` and rejects.
*/
function readJwtRole(key) {
	const segments = key.split(".");
	if (segments.length !== 3) return null;
	const payload = decodeBase64Url(segments[1] ?? "");
	if (payload === null) return null;
	try {
		const parsed = JSON.parse(payload);
		if (typeof parsed !== "object" || parsed === null) return null;
		const role = parsed.role;
		return typeof role === "string" ? role : null;
	} catch {
		return null;
	}
}
var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/**
* Hand-rolled rather than `atob`: this module is imported by `vite.config.ts`,
* which is typechecked under a Node tsconfig with no DOM lib — the same reason
* `csp.ts` avoids `new URL()`.
*
* Returns Latin-1 text. JWT payloads are ASCII JSON in practice; anything else
* fails `JSON.parse` above and is rejected, which is the safe direction.
*/
function decodeBase64Url(segment) {
	if (segment === "") return null;
	let bits = 0;
	let bitCount = 0;
	let output = "";
	for (const character of segment.replaceAll("-", "+").replaceAll("_", "/")) {
		if (character === "=") break;
		const index = BASE64_ALPHABET.indexOf(character);
		if (index < 0) return null;
		bits = bits << 6 | index;
		bitCount += 6;
		if (bitCount >= 8) {
			bitCount -= 8;
			output += String.fromCharCode(bits >> bitCount & 255);
		}
	}
	return output;
}
//#endregion
export { classifySupabaseKey, createReminderStore, createReminderTickHandler, isAllowedPushEndpoint };
