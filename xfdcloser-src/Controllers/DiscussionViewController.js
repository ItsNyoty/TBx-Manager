import { $, mw, OO } from "../../globals";
import API from "../api";
import { dateFromSubpageName, windowOffsetTop, encodeForWikilinkFragment } from "../util"; 
import MainWindowModel from "../Models/MainWindowModel";
import windowSetManager from "../windowSetManager";
import * as prefs from "../prefs";

// <nowiki>
class DiscussionViewController {
	constructor(model, widget) {
		this.model = model;

		this.statusLabel = widget.statusLabel;
		this.buttonGroup = widget.buttonGroup;
		this.closeButton = widget.closeButton;
		this.relistButton = widget.relistButton;
		this.quickCloseButton = widget.quickCloseButtonMenu;
		this.quickCloseMenu = widget.quickCloseButtonMenu.getMenu();

		this.model.connect(this, {update: "updateFromModel"});

		this.closeButton.connect(this, {click: ["onButtonClick", "close"]});
		this.relistButton.connect(this, {click: ["onButtonClick", "relist"]});
		this.quickCloseMenu.connect(this, {choose: "onQuickCloseChoose"});

		if ( this.model.pages.length ) {
			this.fetchInfoFromApi();
		}
	}
	fetchInfoFromApi() {
		const pagesExistencesPromise = API.get({
			action: "query",
			format: "json",
			formatversion: 2,
			titles: this.model.pagesNames,
			prop: "info",
			inprop: "talkid"
		}).then(response => response.query.pages.forEach(page => {
			const pageTitle = mw.Title.newFromText(page.title);
			const talkpageTitle = pageTitle.getTalkPage();
			mw.Title.exist.set(pageTitle.getPrefixedDb(), !page.missing);
			if ( talkpageTitle ) {
				mw.Title.exist.set(talkpageTitle.getPrefixedDb(), !!page.talkid);
			}
		}));
		const dateFromTitle = dateFromSubpageName(this.model.discussionSubpageName);

		const nominationDatePromise = ( !isNaN(dateFromTitle) )
			? $.Deferred().resolve( dateFromTitle )
			: API.get({
				action: "query",
				format: "json",
				formatversion: 2,
				titles: this.model.discussionPageName,
				prop: "revisions",
				rvprop: "timestamp",
				rvdir: "newer",
				rvlimit: "1"
			}).then(response => {
				const page = response.query.pages[0];
				const timestamp = page.revisions[0].timestamp;
				return new Date(timestamp);
			});
		nominationDatePromise.then(nominationDate => {
			this.model.setNominationDate(nominationDate);
		});
		$.when(pagesExistencesPromise, nominationDatePromise)
			.then(() => {
				this.model.setStatusReady();
				this.checkForEditConflictRestore();
			})
			.catch((code, error) => { this.model.setStatusError(code, error); });
	}

	/**
	 * Check localStorage for saved edit conflict data. If found and matching
	 * this discussion, automatically re-open the close dialog and restore
	 * the user's rationale and result selection.
	 */
	checkForEditConflictRestore() {
		try {
			const raw = window.localStorage.getItem("xfdc-editconflict-data");
			if ( !raw ) return;
			const saved = JSON.parse(raw);
			if ( !saved || saved.sectionHeader !== this.model.sectionHeader ) return;

			// Remove immediately so it doesn't trigger again on subsequent reloads
			window.localStorage.removeItem("xfdc-editconflict-data");

			// Ignore data older than 10 minutes
			if ( saved.timestamp && (Date.now() - saved.timestamp) > 10 * 60 * 1000 ) return;

			// Create the window model and restore saved state before opening
			const windowModel = new MainWindowModel({
				type: "close",
				discussion: this.model
			});

			// Restore result state on the model
			if ( saved.selectedResultName ) {
				windowModel.result.singleModeResult.setSelectedResultName(saved.selectedResultName);
			}
			if ( saved.targetPageName ) {
				windowModel.result.singleModeResult.setTargetPageName(saved.targetPageName);
			}
			if ( saved.customResultText ) {
				windowModel.result.singleModeResult.setCustomResultText(saved.customResultText);
			}
			if ( saved.rationale ) {
				windowModel.result.setRationale(saved.rationale);
			}

			// Open the window with the pre-filled model
			const windowInstance = windowSetManager.openWindow("main", {
				model: windowModel,
				offsetTop: windowOffsetTop()
			});

			windowInstance.closed.then(winData => {
				this.model.setClosedWindowData(winData);
				if ( winData && winData.success && prefs.get("reloadOnFinish") ) {
					window.location.hash = encodeForWikilinkFragment(this.model.sectionHeader);
					window.location.reload();
				}
			});
			this.model.setWindowOpened("close");
		} catch(e) {
			// localStorage not available or data corrupt, silently fail
			console.warn("[TBx-Manager] Kon opgeslagen bewerkingsconflict-gegevens niet herstellen", e);
		}
	}

	updateFromModel() {
		this.statusLabel.setLabel(new OO.ui.HtmlSnippet(this.model.status)).toggle(this.model.showStatus);
		this.buttonGroup.toggle(this.model.showButtons);
		this.quickCloseButton.toggle(this.model.showQuickClose);
		if (this.model.actioned) {
			this.model.$headlineSpan.addClass("xfdc-actioned-heading");
			$(`.${this.model.id}-discussion-node`).addClass("xfdc-actioned-discussion");
		}
	}
	
	/**
	 * 
	 * @param {String} type "close" or "relist" 
	 */
	onButtonClick(type) {
		const windowInstance = windowSetManager.openWindow("main", {
			model: new MainWindowModel({
				type,
				discussion: this.model
			}),
			offsetTop: windowOffsetTop()
		});
		windowInstance.closed.then(winData => {
			this.model.setClosedWindowData(winData);
			if ( winData && winData.success && prefs.get("reloadOnFinish") ) {
				window.location.hash = encodeForWikilinkFragment(this.model.sectionHeader);
				window.location.reload();
			}
		});
		this.model.setWindowOpened(type);
	}

	onQuickCloseChoose(menuOption) {
		const quickCloseResult = menuOption.getData();
		const windowModel = new MainWindowModel({
			type: "close",
			quick: true,
			result: quickCloseResult,
			discussion: this.model,
		});
		const windowInstance = windowSetManager.openWindow("main", {
			model: windowModel,
			offsetTop: windowOffsetTop()
		});
		windowInstance.closed.then(winData => {
			this.model.setClosedWindowData(winData);
			if ( winData && winData.success && prefs.get("reloadOnFinish") ) {
				window.location.hash = encodeForWikilinkFragment(this.model.sectionHeader);
				window.location.reload();
			}
		});
		this.model.setWindowOpened("close");
		windowModel.result.singleModeResult.setSelectedResultName(quickCloseResult.replace("quick", "").toLowerCase());
		// If an option needs to be selected, show the options panel (e.g. holding cell section)
		if (!windowModel.options.isValid) {
			windowModel.showOptions();
		} else {
			// Just start doing the tasks
			windowModel.taskList.resetItems();
			windowModel.taskList.startTasks();
		}
	}
}

export default DiscussionViewController;