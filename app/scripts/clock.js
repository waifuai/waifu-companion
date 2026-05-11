const updateClock = function() {
  const dt = dayjs(new Date());
  const element = document.getElementById("time");
  element.innerHTML = `${dt.format('HH')}<span id="colon">:</span>${dt.format('mm')}`;
};

// Initial update
updateClock();

// Update every second
setInterval(updateClock, 1000);