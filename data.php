<?php

function routes() {
    return file_get_contents('http://webservices.nextbus.com/service/publicXMLFeed?command=routeList&a=sf-muni');
}

function vehicles($route) {
    return file_get_contents('http://webservices.nextbus.com/service/publicXMLFeed?command=vehicleLocations&a=sf-muni&t=0&r=' . $route);
}

function stops($route) {
    $url = 'http://webservices.nextbus.com/service/publicXMLFeed?command=routeConfig&a=sf-muni&r=' . $route;
    $xml = file_get_contents($url);
    $data = simplexml_load_string($xml);
    $stops = array();

    foreach($data->route->stop as $stop) {
        $_stop = (array)$stop;
        $stop = $_stop['@attributes'];
        $stops[$stop['tag']] = $stop;
    }

    foreach ($data->route->direction as $direction) {
        foreach ($direction->stop as $stop) {
            $_stop = (array)$stop;
            $obj = $_stop['@attributes'];
            $dir = (array)$direction['name'];
            $dirName = strtolower($dir[0]);
            $stops[$_stop['@attributes']['tag']]['direction'] = $dirName;
        }

    }
    return array_values($stops);
}

$command = isset($_GET['command']) && !empty($_GET['command']) ? $_GET['command'] : '';
$route = isset($_GET['route']) && !empty($_GET['route']) ? $_GET['route'] : '';
$direction = isset($_GET['direction']) && !empty($_GET['direction']) ? $_GET['direction'] : '';
$data = null;

if (!empty($command)) {
    if ($command === 'routes') {
        $data = routes();
        header('Content-type: application/xml');
        echo $data;
    }
    else if ($command === 'vehicles' && !empty($route)) {
        $data = vehicles($route);
        header('Content-type: application/xml');
        echo $data;
    }
    else if ($command === 'stops' && !empty($route)) {
        $data = stops($route);
        header('Content-type: application/json');
        echo json_encode($data);
    }
}