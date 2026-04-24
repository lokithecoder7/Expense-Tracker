// ExpenseAI — starter app data for shared use
// This file is intentionally minimal. User data is stored in browser localStorage.
(function(){
  var d = {};
  Object.entries(d).forEach(function(e){
    if(!localStorage.getItem(e[0])) {
      localStorage.setItem(e[0], typeof e[1] === 'string' ? e[1] : JSON.stringify(e[1]));
    }
  });
})();
