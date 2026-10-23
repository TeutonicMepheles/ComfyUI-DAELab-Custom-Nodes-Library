// The canvas borrows the table body; it must not inherit the native group tab's
// hidden flag. Keep the native selection per instance and restore it on release.
export function createTablePanelViews({editor,groups,tableTab,groupTab}) {
    let groupSelected=false,content=false;
    function sync() {
        editor.root.hidden=groupSelected&&!content;
        groups.root.hidden=content||!groupSelected;
        tableTab.setAttribute('aria-selected',String(!groupSelected));
        groupTab.setAttribute('aria-selected',String(groupSelected));
        if(!groups.root.hidden)groups.render();
    }
    sync();
    return {
        show(group){groupSelected=group;sync();},
        setContent(active){content=active;sync();},
    };
}
