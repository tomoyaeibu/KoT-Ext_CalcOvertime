////////////////////////////// 重要事項 //////////////////////////////
// startは出社，endは退社を表す．


////////////////////////////// 設定項目 //////////////////////////////

// デフォルト設定値
var DEFAULT_SETTINGS = {
    OFFICETIME: 9,      // 在社時間(h) 休憩含む
    WORKTIME: 8,        // 業務時間(h)
    DISPLAY: 1,         // 表示形式 0: フルタイトル + ウィジェット 1: コンパクトタイトル + ウィジェット
    CALCOVERTIMEFLAG: 0 // 残業時間を加味した退社時間を算出する
};

// 設定を読み込む関数
function loadSettings() {
    try {
        const savedSettings = localStorage.getItem('kotUserScriptSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            return { ...DEFAULT_SETTINGS, ...settings };
        }
    } catch (error) {
        console.warn('設定の読み込みに失敗しました:', error);
    }
    return DEFAULT_SETTINGS;
}

// 設定を保存する関数
function saveSettings(settings) {
    try {
        localStorage.setItem('kotUserScriptSettings', JSON.stringify(settings));
        return true;
    } catch (error) {
        console.error('設定の保存に失敗しました:', error);
        return false;
    }
}

// 現在の設定を読み込み
var CURRENT_SETTINGS = loadSettings();
var OFFICETIME = CURRENT_SETTINGS.OFFICETIME;
var WORKTIME = CURRENT_SETTINGS.WORKTIME;
var DISPLAY = CURRENT_SETTINGS.DISPLAY;
var CALCOVERTIMEFLAG = CURRENT_SETTINGS.CALCOVERTIMEFLAG;


////////////////////////////// Utility //////////////////////////////

//-----------------------
// * 時間量を意味する時間クラス
// *
class Time {
    constructor(totalMinutes = 0) {
        this.totalMinutes = totalMinutes;
    }

    // コンストラクター：totalMinutesを受け取る静的メソッド
    static constructByTotalHours(total_hours) {
        return new Time(total_hours * 60);
    }

    // コンストラクター：KOT時間を受け取る静的メソッド
    static constructByKotTime(kot_time) {
        let total_minutes = Math.floor(kot_time) * 60 + Math.round((kot_time - Math.floor(kot_time)) * 100);
        return new Time(total_minutes);
    }

    // totalMinutesが負値の場合は以下のように扱う。
    // ex) totalMinutes = -10 //// [0:-10] (hh = 0)
    // ex) totalMinutes = -70 //// [-1:10] (hh = -1)
    getHours() {
        let hours = Math.trunc(this.totalMinutes / 60);
        return hours;
    }

    // totalMinutesをhh:mmで表示した際のmmを返す
    getMinutes() {
        let minutes = this.totalMinutes % 60;
        return minutes;
    }

    // KOT時間のフォーマットで出力するメソッド
    toKotTime() {
        let kot_time = this.getHours() + this.getMinutes() / 100;
        return kot_time.toFixed(2);
    }

    // ":"を用いたClockフォーマットで出力するメソッド
    // Time.toClockLikeString : 負の時間量を許容し,負の時間量に対して[-hh:mm]という表記を出力する
    // Clock.toClockString：負の時刻を許容せず,必ず[hh:mm]という表記を出力する
    toClockLikeString() {
        let sign = (this.totalMinutes < 0 && this.totalMinutes > -60) ? "-" : "";
        let formatted_hours = this.getHours().toString();
        let formatted_minutes = Math.abs(this.getMinutes()).toString().padStart(2, "0").slice(-2);
        return `${sign}${formatted_hours}:${formatted_minutes}`;
    }

    // Time + Time = Time として計算するメソッド
    plusTime(another_time) {
        return new Time(this.totalMinutes + another_time.totalMinutes);
    }

    // Time - Time = Time として計算するメソッド
    minusTime(another_time) {
        return new Time(this.totalMinutes - another_time.totalMinutes);
    }
};

//-----------------------
// * 特定の時刻を意味する時刻クラス
// *
class Clock {
    constructor(HH = "--", MM = "--") {
        this.HH = HH;
        this.MM = MM;
    }

    // Clockフォーマットの文字として出力するメソッド
    toClockString() {
        let formatted_hh = typeof this.HH === "number" ? this.HH.toString().padStart(2, "0") : this.HH;
        let formatted_mm = typeof this.MM === "number" ? this.MM.toString().padStart(2, "0") : this.MM;
        return `${formatted_hh}:${formatted_mm}`;
    }

    // 無効な時刻の場合エラーを返すメソッド
    validateSelf() {
        if (typeof this.HH !== "number" || typeof this.MM !== "number") {
            throw new Error("Invalid Clock.");
        }
    }

    // Timeの分だけ経過したClockを計算する
    elapsesBy(time) {
        this.validateSelf();

        let new_hh = (this.HH + Math.floor((this.MM + time.totalMinutes) / 60)) % 24;
        let new_mm = (this.MM + time.totalMinutes) % 60;
        return new Clock(new_hh, new_mm);
    }

    // Timeの分だけ巻き戻したClockを計算する
    rewindBy(time) {
        this.validateSelf();

        // CoreTimeの考慮を入れる
        if ((this.HH + Math.floor((this.MM - time.totalMinutes) / 60)) % 24 < 15){
            return new Clock(15, 0); // CoreTime
        } else {
            let new_hh = (this.HH + Math.floor((this.MM - time.totalMinutes) / 60)) % 24 < 15 ? 15 : (this.HH + Math.floor((this.MM - time.totalMinutes) / 60)) % 24;
            let new_mm = (this.MM - time.totalMinutes) % 60;
            if (new_mm < 0) new_mm += 60;
            return new Clock(new_hh, new_mm);
        }
    }

    // 2つのClockからTimeを計算する
    // 休憩時間も退社時間の考慮に入れる場合に使用する。未実装
    // calcElapsedTime(another_clock) {
    //     this.validateSelf();
    //     another_clock.checkErrorClock();

    //     let current_time_in_minutes = this.HH * 60 + this.MM;
    //     let another_time_in_minutes = another_clock.HH * 60 + another_clock.MM;

    //     return new Time(current_time_in_minutes - another_time_in_minutes);
    // }
};

//-----------------------
// * 『労働合計』と『総出勤日数』などのクラス名をサーチする。
// *
function GetCustomXX(obj, target_str){
    // クラス名をサーチする。
    if ((obj.localName == "th" ||obj.localName=="label") && // FIXME::労働合計と総出勤日数をひっかけるためにこのスコープにしている。
        obj.textContent.match(target_str) &&
        obj.className.match ("custom")) {
        return obj.className;
    }

    // 再帰的に子オブジェクトもサーチする。
    var temp_array = Array.prototype.slice.call(obj.children);
    for (let item of temp_array) {
        var custom_xx = GetCustomXX(item, target_str) ;
        if ( typeof custom_xx !== "undefined") {
            return custom_xx;
        }
    }
}

//----------------------

////////////////// Parse time card. //////////////////////////

//-----------------------
// * 勤務がすでに完了した日かどうか。
// * 引数のiは「日別データ」表の縦のインデックスを表す。
var IsWorkCompletedDay = function(i) {
    var elms = document.getElementsByClassName("custom16"); //FIXME:『労働合計』のcustom16を自動検出したい。
    elms = Array.from(elms).slice(3); //index0,1,2は見出しなので削除する。

    var str = elms[i].textContent;

    var result = false;
    if (str.match(/[0-9]/)) {
        result = true;
    }

    return result;
}


//-----------------------
// * 「労働時間合計(有休/半休/時間休を含まない)」を計算する。
// *
var WorkingTime_KotHours = function() {
    var elms = document.getElementsByClassName(GetCustomXX(document.body, "労働合計有休除く")); // "customX"のクラス名を持つ要素はたくさんあるが、一番最初の数字が「労働合計有休除く」

    var result = 0;
    for (var i = 0; i < elms.length; i++) {
        var str = elms[i].textContent;
        if (str.match(/[0-9]/)) {
            result = parseFloat(str);
            break;
        }
    }

    return result
};

//-----------------------
// * 「休日出勤」を計算する。
// *
var WeekendWorkingTime_KotHours = function() {
    var elms = document.getElementsByClassName(GetCustomXX(document.body, "休日所定")); // "customX"のクラス名を持つ要素はたくさんあるが、一番最初の数字が「労働合計有休除く」

    var result = 0;
    for (var i = 0; i < elms.length; i++) {
        var str = elms[i].textContent;
        if (str.match(/[0-9]/)) {
            result = parseFloat(str);
            break;
        }
    }

    return result;
};

//-----------------------
// * 「有休合計時間(有休/半休/時間休を含む) 」を計算する。
// *
var PaidHoliday_IntHours = function() {
    var elms = document.getElementsByClassName("holiday_count")[1]; //「時間休」※index:1に有休の値が入るのはKOTの仕様によって変わります。
    var str = elms.textContent;

    var result = 0;

    // 何日？([*.*]の部分)
    var days = 0;
    if (str.match(/[0-9]/)) {
        days = parseFloat(str);
    }

    // 何時間？([*H]の部分)
    var hours = 0;
    hours = str.match(/\dH/)[0].match(/\d/)
    hours = parseInt(hours, 10);

    result = days * WORKTIME + hours;

    return result
};

//-----------------------
// * 「有休日数」を計算する。
// *
var PaidHoliday_IntDays = function() {
    var elms = document.getElementsByClassName("specific-timecard_schedule");

    var result = 0;
    for (var i = 0; i < elms.length; i++) {
        if (!IsWorkCompletedDay(i)) {
            continue;
        }

        var str = elms[i].innerText;
        if (str.endsWith("有休")) {
            result += 1
        }
    }

    return result;
};

//-----------------------
// * 「半休日数」を計算する。
// *
var HalfHoliday_IntDays = function() {
    var elms = document.getElementsByClassName("specific-timecard_schedule");

    var result = 0;
    for (var i = 0; i < elms.length; i++) {
        if (!IsWorkCompletedDay(i)) {
            continue;
        }

        var str = elms[i].innerText;
        if (str.match(/AM有休/)) {
            result += 1
        }
        if (str.match(/PM有休/)) {
            result += 1
        }
    }

    return result;
};

//-----------------------
// * 「時間休」を計算する。
// *
var HourHoliday_IntHours = function() {
    return PaidHoliday_IntHours() - (PaidHoliday_IntDays() * WORKTIME) - (HalfHoliday_IntDays() * WORKTIME * 0.5)
};

//-----------------------
// * 「代休日数」を計算する。
// *
var CompHoliday_IntDays = function() {
    var elms = document.getElementsByClassName("holiday_count")[3]; //「代休」※index:3に代休の値が入るのはKOTの仕様によって変わります。
    var str = elms.textContent;

    var result = 0;
    if (str.match(/[0-9]/)) {
        result = parseFloat(str);
    }

    return result;
};

//-----------------------
// * 「平日日数(有休/半休を含む)」を計算する。
// *
var WorkingDay_IntDays = function() {
    var elms = document.getElementsByClassName("work_count");

    var result = 0;

    // 「平日」の値を取得する。
    for (var i = 0; i < elms.length; i++) {
        var str = elms[i].textContent;
        if (str.match(/[0-9]/)) {
            result = parseFloat(str);
            break;
        }
    }

    // 半休と有休が引かれているので、その分プラスする。
    result += (PaidHoliday_IntDays()) + (HalfHoliday_IntDays() * 0.5)

    return result;
};

//-----------------------
// * 表示しているタイムカードが今月のものか確認する
// *
var isCurrentMonthAndYear = function() {
    let timecard_date = document.getElementById("select_year_month_picker").value;
    let timecard_year = timecard_date.split("/")[0];
    let timecard_month = parseInt(timecard_date.split("/")[1], 10) - 1;

    let today_date = new Date();
    let is_displayed_timecard_this_year = (timecard_year == today_date.getFullYear());
    let is_displayed_timecard_this_month = (timecard_month == today_date.getMonth());
    return (is_displayed_timecard_this_year && is_displayed_timecard_this_month);
};

//-----------------------
// * タイムカードから時刻を取得する関数群
// *
var getClockFromTimeCard = function(html_classname, index) {
    let elms_start = document.getElementsByClassName(html_classname);
    let clockstr = elms_start[index].textContent;

    let clockarray = clockstr.match(/\d+:\d+/);
    if (clockarray == null) {
        return clockarray;
    }

    let hh_mm = clockarray[0].split(":")
    let hh = parseInt(hh_mm[0], 10);
    let mm = parseInt(hh_mm[1], 10);
    return new Clock(hh, mm);
};

var getStartClockFromTimeCard = function() {
    let today_date = new Date();
    // 今日の出社時刻を取得するために必要な特殊な引数
    return getClockFromTimeCard("start_end_timerecord", today_date.getDate() * 2);
}

var getEndClockFromTimeCard = function() {
    let today_date = new Date();
    // 今日の退社時刻を取得するために必要な特殊な引数
    return getClockFromTimeCard("start_end_timerecord", today_date.getDate() * 2 + 1);
}

//-----------------------
// * 今日の出社時刻が記録されていることを確認する．
// *
var hasTodayStartClockRecorded = function() {
    if (!isCurrentMonthAndYear()) {
        return false;
    } else {
        return getStartClockFromTimeCard() != null;
    }
};

//-----------------------
// * 今日の退社時刻が記録されていることを確認する．
// *
var hasTodayEndClockRecorded = function() {
    if (!isCurrentMonthAndYear()) {
        return false;
    } else {
        return getEndClockFromTimeCard() != null;
    }
};

////////////////// UI Implmentation. //////////////////////////

//-----------------------
// * widgetの作成
// *
var makeWidget = function(overtime_str, today_end_clock_str, debugInfo) {
    // ウィジェット用のdiv要素を作成
    var widget = document.createElement("div");
    widget.id = "myWidget";
    widget.style.position = "fixed";
    widget.style.bottom = "50px";
    widget.style.right = "20px";
    widget.style.zIndex = "1000";
    widget.style.backgroundColor = "#1D9E48";
    widget.style.padding = "48px 20px 20px 20px"; // 上部余白をさらに増やす
    widget.style.borderRadius = "10px";
    widget.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.1)";
    widget.style.minWidth = "210px";
    widget.style.minHeight = "110px"; // 最小高さを追加
    widget.style.boxSizing = "border-box";
    document.body.appendChild(widget);

    // Aの要素を作成し、ウィジェットに追加
    var itemA = document.createElement("div");
    itemA.style.display = "flex";
    itemA.style.justifyContent = "space-between";
    itemA.style.width = "100%";
    itemA.style.color = "#ffffff";

    var labelA = document.createElement("span");
    labelA.textContent = "残業合計";
    itemA.appendChild(labelA);

    var valueA = document.createElement("span");
    valueA.style.minWidth = "50px";
    valueA.textContent = overtime_str;
    valueA.style.textAlign = "right";
    valueA.style.marginLeft = "auto";
    itemA.appendChild(valueA);

    widget.appendChild(itemA);

    // Bの要素を作成し、ウィジェットに追加
    var itemB = document.createElement("div");
    itemB.style.display = "flex";
    itemB.style.justifyContent = "space-between";
    itemB.style.width = "100%";
    itemB.style.color = "#ffffff";

    var labelB = document.createElement("span");
    labelB.textContent = "目標退社時刻";
    itemB.appendChild(labelB);

    var valueB = document.createElement("span");
    valueB.style.minWidth = "50px";
    valueB.textContent = today_end_clock_str;
    valueB.style.textAlign = "right";
    itemB.appendChild(valueB);

    widget.appendChild(itemB);

    // 設定ボタンを作成
    var settingsButton = document.createElement("button");
    settingsButton.textContent = "⚙";
    settingsButton.style.position = "absolute";
    settingsButton.style.top = "12px"; // さらに下げる
    settingsButton.style.left = "18px";
    settingsButton.style.width = "30px";
    settingsButton.style.height = "30px";
    settingsButton.style.border = "none";
    settingsButton.style.borderRadius = "15px";
    settingsButton.style.background = "rgba(0,0,0,0.2)";
    settingsButton.style.color = "#ffffff";
    settingsButton.style.fontSize = "16px";
    settingsButton.style.cursor = "pointer";
    settingsButton.title = "設定";
    widget.appendChild(settingsButton);
    settingsButton.addEventListener("click", showSettingsModal);

    // インフォメーションボタンを作成
    var infoButton = document.createElement("button");
    infoButton.textContent = "i";
    infoButton.style.position = "absolute";
    infoButton.style.top = "12px"; // さらに下げる
    infoButton.style.left = "58px";
    infoButton.style.width = "30px";
    infoButton.style.height = "30px";
    infoButton.style.border = "none";
    infoButton.style.borderRadius = "15px";
    infoButton.style.background = "rgba(0,0,0,0.2)";
    infoButton.style.color = "#ffffff";
    infoButton.style.fontSize = "16px";
    infoButton.style.cursor = "pointer";
    infoButton.title = "インフォメーション";
    widget.appendChild(infoButton);
    infoButton.addEventListener("click", function() {
        showInfoModal(debugInfo);
    });

    // 閉じるボタンを作成
    var closeButton = document.createElement("button");
    closeButton.textContent = "×";
    closeButton.style.position = "absolute";
    closeButton.style.top = "12px"; // さらに下げる
    closeButton.style.right = "18px";
    closeButton.style.width = "30px";
    closeButton.style.height = "30px";
    closeButton.style.border = "none";
    closeButton.style.borderRadius = "15px";
    closeButton.style.background = "transparent";
    closeButton.style.color = "#ffffff";
    closeButton.style.fontSize = "20px";
    closeButton.style.fontWeight = "bold";
    widget.appendChild(closeButton);
    closeButton.addEventListener("click", function() {
        widget.style.display = "none";
    });

    // ウィジェットを再表示するボタンを作成
    var showWidgetButton = document.createElement("button");
    showWidgetButton.textContent = "^";
    showWidgetButton.style.position = "fixed";
    showWidgetButton.style.bottom = "50px";
    showWidgetButton.style.right = "20px";
    showWidgetButton.style.width = "40px";
    showWidgetButton.style.height = "40px";
    showWidgetButton.style.border = "none";
    showWidgetButton.style.backgroundColor = "#1D9E48";
    showWidgetButton.style.borderRadius = "20px";
    showWidgetButton.style.color = "#ffffff";
    showWidgetButton.style.fontSize = "20px";
    showWidgetButton.style.fontWeight = "bold";
    showWidgetButton.style.paddingTop = "5px";
    showWidgetButton.style.zIndex = "999";
    document.body.appendChild(showWidgetButton);

    showWidgetButton.addEventListener("click", function() {
        widget.style.display = "block";
    });
    showWidgetButton.addEventListener('mouseover', function() {
        showWidgetButton.style.backgroundColor = '#008735';
    });
    showWidgetButton.addEventListener('mouseout', function() {
        showWidgetButton.style.backgroundColor = "#1D9E48";
    });
};

// 設定モーダルのHTMLを作成
function createSettingsModal() {
    const modalHTML = `
        <div id="kotSettingsModal" style="
            display: none;
            position: fixed;
            z-index: 10000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        ">
            <div style="
                background-color: #fefefe;
                margin: 10% auto;
                padding: 20px;
                border: none;
                border-radius: 10px;
                width: 400px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            ">
                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    border-bottom: 2px solid #f0f0f0;
                    padding-bottom: 10px;
                ">
                    <h2 style="margin: 0; color: #333;">設定</h2>
                    <button id="kotSettingsClose" style="
                        background: none;
                        border: none;
                        font-size: 24px;
                        cursor: pointer;
                        color: #999;
                        padding: 0;
                        width: 30px;
                        height: 30px;
                    ">&times;</button>
                </div>
                
                <form id="kotSettingsForm">
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">
                            在社時間 (時間) - 休憩含む
                        </label>
                        <input type="number" id="officetime" min="1" max="24" step="0.5" style="
                            width: 100%;
                            padding: 8px;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            box-sizing: border-box;
                        ">
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">
                            業務時間 (時間)
                        </label>
                        <input type="number" id="worktime" min="1" max="24" step="0.5" style="
                            width: 100%;
                            padding: 8px;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            box-sizing: border-box;
                        ">
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">
                            表示形式
                        </label>
                        <select id="display" style="
                            width: 100%;
                            padding: 8px;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            box-sizing: border-box;
                        ">
                            <option value="0">フルタイトル + ウィジェット表示</option>
                            <option value="1">コンパクトタイトル + ウィジェット表示</option>
                        </select>
                    </div>
                    
                    <div style="margin-bottom: 20px;">
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input type="checkbox" id="calcovertimeflag" style="margin-right: 8px;">
                            <span style="font-weight: bold; color: #555;">残業時間を加味した退社時間を算出する</span>
                        </label>
                    </div>
                    
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" id="kotSettingsCancel" style="
                            padding: 10px 20px;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            background-color: #f8f8f8;
                            cursor: pointer;
                            font-size: 14px;
                        ">キャンセル</button>
                        <button type="button" id="kotSettingsReset" style="
                            padding: 10px 20px;
                            border: 1px solid #ff6b6b;
                            border-radius: 4px;
                            background-color: #ff6b6b;
                            color: white;
                            cursor: pointer;
                            font-size: 14px;
                        ">リセット</button>
                        <button type="submit" style="
                            padding: 10px 20px;
                            border: none;
                            border-radius: 4px;
                            background-color: #1D9E48;
                            color: white;
                            cursor: pointer;
                            font-size: 14px;
                        ">保存</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// 設定モーダルを表示
function showSettingsModal() {
    const modal = document.getElementById('kotSettingsModal');
    const form = document.getElementById('kotSettingsForm');
    
    // 現在の設定値をフォームに設定
    document.getElementById('officetime').value = CURRENT_SETTINGS.OFFICETIME;
    document.getElementById('worktime').value = CURRENT_SETTINGS.WORKTIME;
    document.getElementById('display').value = CURRENT_SETTINGS.DISPLAY;
    document.getElementById('calcovertimeflag').checked = CURRENT_SETTINGS.CALCOVERTIMEFLAG === 1;
    
    modal.style.display = 'block';
}

// 設定モーダルを非表示
function hideSettingsModal() {
    const modal = document.getElementById('kotSettingsModal');
    modal.style.display = 'none';
}

// 設定を適用してページをリロード
function applySettings(settings) {
    if (saveSettings(settings)) {
        alert('設定を保存しました。ページをリロードして変更を適用します。');
        location.reload();
    } else {
        alert('設定の保存に失敗しました。');
    }
}

// 設定モーダルのイベントリスナーを設定
function setupSettingsModal() {
    createSettingsModal();
    
    const modal = document.getElementById('kotSettingsModal');
    const closeBtn = document.getElementById('kotSettingsClose');
    const cancelBtn = document.getElementById('kotSettingsCancel');
    const resetBtn = document.getElementById('kotSettingsReset');
    const form = document.getElementById('kotSettingsForm');
    
    // 閉じるボタン
    closeBtn.onclick = hideSettingsModal;
    cancelBtn.onclick = hideSettingsModal;
    
    // モーダル外クリックで閉じる
    modal.onclick = function(event) {
        if (event.target === modal) {
            hideSettingsModal();
        }
    };
    
    // リセットボタン
    resetBtn.onclick = function() {
        if (confirm('設定をデフォルト値にリセットしますか？')) {
            applySettings(DEFAULT_SETTINGS);
        }
    };
    
    // フォーム送信
    form.onsubmit = function(event) {
        event.preventDefault();
        
        const newSettings = {
            OFFICETIME: parseFloat(document.getElementById('officetime').value),
            WORKTIME: parseFloat(document.getElementById('worktime').value),
            DISPLAY: parseInt(document.getElementById('display').value),
            CALCOVERTIMEFLAG: document.getElementById('calcovertimeflag').checked ? 1 : 0
        };
        
        // バリデーション
        if (newSettings.OFFICETIME <= 0 || newSettings.WORKTIME <= 0) {
            alert('時間は0より大きい値を入力してください。');
            return;
        }
        
        if (newSettings.OFFICETIME < newSettings.WORKTIME) {
            alert('在社時間は業務時間以上である必要があります。');
            return;
        }

        // DISPLAY値を0または1に制限
        if (newSettings.DISPLAY !== 0 && newSettings.DISPLAY !== 1) {
            newSettings.DISPLAY = 1;
        }
        
        applySettings(newSettings);
    };
}

//-----------------------
// * インフォメーションモーダルのHTMLを作成
//
function createInfoModal(debugInfo) {
    // 既存があれば削除
    const old = document.getElementById('kotInfoModal');
    if (old) old.remove();

    const modalHTML = `
        <div id="kotInfoModal" style="
            display: none;
            position: fixed;
            z-index: 10001;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.3);
        ">
            <div style="
                background-color: #fefefe;
                margin: 10% auto;
                padding: 20px;
                border: none;
                border-radius: 10px;
                width: 420px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.2);
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            ">
                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    border-bottom: 2px solid #f0f0f0;
                    padding-bottom: 10px;
                ">
                    <h2 style="margin: 0; color: #333;">インフォメーション</h2>
                    <button id="kotInfoClose" style="
                        background: none;
                        border: none;
                        font-size: 24px;
                        cursor: pointer;
                        color: #999;
                        padding: 0;
                        width: 30px;
                        height: 30px;
                    ">&times;</button>
                </div>
                <div style="margin-bottom: 18px; color: #444;">
                    <b>このスクリプトについて</b><br>
                    <span>
                        KOT勤怠システムのタイムカード画面に「残業時間合計」を表示するスクリプトです。<br>
                        KOT勤怠システムに表示されている「残業合計」は1日ごとに8時間を超えた分の残業時間を足した時間が表示されているため、早く帰宅した分の時間は加味されていません。<br>
                        このスクリプトは、実際の勤務時間と適正な勤務時間を比較し、残業時間を計算して表示します。<br
                        非公式のスクリプトです。KOT勤怠システムの仕様変更により動作しなくなる可能性があります。
                    </span>
                </div>
                <div style="margin-bottom: 10px; color: #444;">
                    <b>デバッグ情報</b>
                    <pre style="background:#f8f8f8; border-radius:6px; padding:10px; font-size:13px; color:#222; overflow-x:auto;">${debugInfo}</pre>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // 閉じるボタン
    document.getElementById('kotInfoClose').onclick = hideInfoModal;
    // モーダル外クリックで閉じる
    document.getElementById('kotInfoModal').onclick = function(event) {
        if (event.target === this) hideInfoModal();
    };
}

// インフォメーションモーダルを表示
function showInfoModal(debugInfo) {
    createInfoModal(debugInfo);
    document.getElementById('kotInfoModal').style.display = 'block';
}

// インフォメーションモーダルを非表示
function hideInfoModal() {
    const modal = document.getElementById('kotInfoModal');
    if (modal) modal.style.display = 'none';
}

//////////////////////////////////////////////////////////////

//-------------------------------
// * main
// *
(function() {
    // 設定UIを初期化
    setupSettingsModal();

    /////////////////////////////////////////////////////////////////////////////////////

    let actual_working_time = Time.constructByKotTime(WorkingTime_KotHours());
    let workingday_time = Time.constructByTotalHours(WorkingDay_IntDays() * WORKTIME);
    let weekendworking_time = Time.constructByTotalHours(WeekendWorkingTime_KotHours());
    let paidholiday_time = Time.constructByTotalHours(PaidHoliday_IntHours());
    let compholiday_time = Time.constructByTotalHours(CompHoliday_IntDays() * WORKTIME);
    let proper_working_time = workingday_time.plusTime(weekendworking_time).minusTime(paidholiday_time).minusTime(compholiday_time);

    // デバッグ情報をまとめる
    let debugInfo =
        "労働時間合計(有休/半休/時間休を含まない): " + WorkingTime_KotHours() + "\n" +
        "平日日数(有休/半休を含む): " + WorkingDay_IntDays() + "\n" +
        "有休合計時間(有休/半休/時間休を含む): " + PaidHoliday_IntHours() + "\n" +
        "有休: " + PaidHoliday_IntDays() + "\n" +
        "半休: " + HalfHoliday_IntDays() + "\n" +
        "時間休: " + HourHoliday_IntHours() + "\n" +
        "休日出勤: " + WeekendWorkingTime_KotHours() + "\n" +
        "代休: " + CompHoliday_IntDays() + "\n" +
        "----------------------------------------\n" +
        "実際の勤務時間: " + actual_working_time.toKotTime() + " 時間 (" + actual_working_time.totalMinutes + "分)\n" +
        "  └ 計算式: 労働時間合計(有休/半休/時間休を含まない)\n" +
        "適正な勤務時間: " + proper_working_time.toKotTime() + " 時間 (" + proper_working_time.totalMinutes + "分)\n" +
        "  └ 計算式: (平日日数×業務時間 + 休日出勤) - (有休合計時間 + 代休×業務時間)\n" +
        "    = " + WorkingDay_IntDays() + "×" + WORKTIME + " + " + WeekendWorkingTime_KotHours() + " - (" + PaidHoliday_IntHours() + " + " + CompHoliday_IntDays() + "×" + WORKTIME + ")";

    console.log("")
    console.log("実際の勤務時間： " + actual_working_time.totalMinutes + "(" + actual_working_time.toKotTime() + ")")
    console.log("適正な勤務時間： " + proper_working_time.totalMinutes + "(" + proper_working_time.toKotTime() + ")")

    /////////////////////////////////////////////////////////////////////////////////////

    // 残業時間を計算する．
    let overtime = actual_working_time.minusTime(proper_working_time);

    // clockを未取得の状態にする
    let today_start_clock = new Clock();
    let today_end_clock = new Clock();

    if (hasTodayStartClockRecorded() && !hasTodayEndClockRecorded()) {
        //出社時刻を取得する。
        today_start_clock = getStartClockFromTimeCard();

        // 目標退社時刻を更新する
        let today_proper_working_time = Time.constructByTotalHours(OFFICETIME);
        today_end_clock = today_start_clock.elapsesBy(today_proper_working_time);

        if (CALCOVERTIMEFLAG) {
            today_end_clock = today_end_clock.rewindBy(overtime);
        }
    }

    // ページタイトルに残業時間などを表示し、常にウィジェットも表示する
    switch (DISPLAY) {
        case 0: // フルタイトル + ウィジェット
            document.title = "残業合計: " + overtime.toClockLikeString();
            document.title += " 目標退社時刻: " + today_end_clock.toClockString();
            break;
        case 1: // コンパクトタイトル + ウィジェット
        default:
            document.title = overtime.toClockLikeString() + " / " + today_end_clock.toClockString();
            document.title += " (残業合計/目標退社時刻) ";
            break;
    }

    // 常にウィジェットを表示
    // 体裁を整えるための処理
    if (today_end_clock.HH == "--") {
        today_end_clock.HH = " - - ";
        today_end_clock.MM = " - - ";
    }
    makeWidget(overtime.toClockLikeString(), today_end_clock.toClockString(), debugInfo);
})()