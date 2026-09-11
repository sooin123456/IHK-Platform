begin;

-- Keep the database authority byte-for-byte aligned with P4_MEASUREMENT_V1.
-- Primitive objects were previously count-only in SQL even though the shared
-- TypeScript kernel exposes their exact length and area measurements.
create or replace function private.lukas_drawing_p6_measure(
  p_geometry jsonb,p_kind text,p_snapshot_objects jsonb default null
)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare v_type text:=p_geometry->>'type'; v_width numeric; v_height numeric;
declare v_dx numeric; v_dy numeric; v_radius numeric; v_sweep numeric;
declare v_start_x numeric; v_start_y numeric; v_end_x numeric; v_end_y numeric;
declare v_count integer; v_index integer; v_next integer; v_point jsonb; v_next_point jsonb;
declare v_x numeric; v_y numeric; v_next_x numeric; v_next_y numeric;
declare v_doubled_area numeric:=0; v_edges numeric[]:='{}'; v_edge numeric;
declare v_precision numeric; v_lower numeric; v_uncertainty numeric; v_root numeric;
declare v_lower_bucket numeric; v_upper_bucket numeric; v_closed boolean;
declare v_host jsonb; v_host_count integer; v_offset numeric; v_sill numeric;
declare v_host_height numeric; v_host_squared numeric;
begin
  if pg_catalog.jsonb_typeof(p_geometry)<>'object'
    or p_kind not in ('length','area','count') then
    raise exception using errcode='P6Q01',message='P4 measurement is unavailable';
  end if;
  if private.lukas_drawing_geometry_valid(v_type,p_geometry) is not true then
    raise exception using errcode='P6Q01',message='P4 geometry is invalid';
  end if;
  if v_type in ('wall','grid','opening','space','area','arc')
    and (pg_catalog.jsonb_typeof(p_geometry->'semanticVersion')<>'number'
      or p_geometry->>'semanticVersion'<>'1') then
    raise exception using errcode='P6Q01',message='P4 geometry is invalid';
  end if;
  if v_type in ('wall','grid','line') then
    v_start_x:=private.lukas_drawing_p6_scaled_integer(p_geometry#>'{start,x}');
    v_start_y:=private.lukas_drawing_p6_scaled_integer(p_geometry#>'{start,y}');
    v_end_x:=private.lukas_drawing_p6_scaled_integer(p_geometry#>'{end,x}');
    v_end_y:=private.lukas_drawing_p6_scaled_integer(p_geometry#>'{end,y}');
    v_dx:=v_end_x-v_start_x; v_dy:=v_end_y-v_start_y;
    if v_dx=0 and v_dy=0 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if p_kind='count' then return 1; end if;
    if p_kind='length' then
      v_edge:=v_dx*v_dx+v_dy*v_dy;
      v_root:=private.lukas_drawing_p6_integer_sqrt(v_edge);
      if v_edge-v_root*v_root >=(v_root+1)*(v_root+1)-v_edge then
        v_root:=v_root+1;
      end if;
      return v_root/1000000000;
    end if;
  elsif v_type='polyline' then
    if p_kind='count' then return 1; end if;
    v_count:=pg_catalog.jsonb_array_length(p_geometry->'points');
    v_closed:=(p_geometry->>'closed')::boolean;
    v_lower:=0; v_doubled_area:=0;
    for v_index in 0..v_count-2 loop
      v_point:=p_geometry->'points'->v_index;
      v_next_point:=p_geometry->'points'->(v_index+1);
      v_x:=private.lukas_drawing_p6_scaled_integer(v_point->'x');
      v_y:=private.lukas_drawing_p6_scaled_integer(v_point->'y');
      v_next_x:=private.lukas_drawing_p6_scaled_integer(v_next_point->'x');
      v_next_y:=private.lukas_drawing_p6_scaled_integer(v_next_point->'y');
      v_dx:=v_next_x-v_x; v_dy:=v_next_y-v_y;
      v_edge:=v_dx*v_dx+v_dy*v_dy;
      v_root:=private.lukas_drawing_p6_integer_sqrt(v_edge);
      if v_edge-v_root*v_root >=(v_root+1)*(v_root+1)-v_edge then
        v_root:=v_root+1;
      end if;
      v_lower:=v_lower+v_root;
      v_doubled_area:=v_doubled_area+v_x*v_next_y-v_next_x*v_y;
    end loop;
    if v_closed then
      v_point:=p_geometry->'points'->(v_count-1);
      v_next_point:=p_geometry->'points'->0;
      v_x:=private.lukas_drawing_p6_scaled_integer(v_point->'x');
      v_y:=private.lukas_drawing_p6_scaled_integer(v_point->'y');
      v_next_x:=private.lukas_drawing_p6_scaled_integer(v_next_point->'x');
      v_next_y:=private.lukas_drawing_p6_scaled_integer(v_next_point->'y');
      v_dx:=v_next_x-v_x; v_dy:=v_next_y-v_y;
      v_edge:=v_dx*v_dx+v_dy*v_dy;
      v_root:=private.lukas_drawing_p6_integer_sqrt(v_edge);
      if v_edge-v_root*v_root >=(v_root+1)*(v_root+1)-v_edge then
        v_root:=v_root+1;
      end if;
      v_lower:=v_lower+v_root;
      v_doubled_area:=v_doubled_area+v_x*v_next_y-v_next_x*v_y;
    end if;
    if p_kind='length' then return v_lower/1000000000; end if;
    if p_kind='area' and v_closed then
      return private.lukas_drawing_p6_round_positive(
        pg_catalog.abs(v_doubled_area),2000000
      )/1000000000000;
    end if;
  elsif v_type='rectangle' then
    if p_kind='count' then return 1; end if;
    v_width:=private.lukas_drawing_p6_scaled_integer(p_geometry->'width');
    v_height:=private.lukas_drawing_p6_scaled_integer(p_geometry->'height');
    if v_width<=0 or v_height<=0 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if p_kind='length' then return 2*(v_width+v_height)/1000000000; end if;
    if p_kind='area' then
      return private.lukas_drawing_p6_round_positive(
        v_width*v_height,1000000
      )/1000000000000;
    end if;
  elsif v_type='circle' then
    if p_kind='count' then return 1; end if;
    v_radius:=private.lukas_drawing_p6_scaled_integer(p_geometry->'radius');
    if v_radius<=0 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if p_kind='length' then
      return private.lukas_drawing_p6_round_positive(
        2*v_radius*3141592653589793,1000000000000000
      )/1000000000;
    end if;
    if p_kind='area' then
      return private.lukas_drawing_p6_round_positive(
        v_radius*v_radius*3141592653589793,
        1000000::numeric*1000000000000000
      )/1000000000000;
    end if;
  elsif v_type='opening' then
    v_width:=private.lukas_drawing_p6_scaled_integer(p_geometry->'widthMillimeters');
    v_height:=private.lukas_drawing_p6_scaled_integer(p_geometry->'heightMillimeters');
    v_offset:=private.lukas_drawing_p6_scaled_integer(p_geometry->'offsetMillimeters');
    v_sill:=private.lukas_drawing_p6_scaled_integer(p_geometry->'sillHeightMillimeters');
    if v_width<=0 or v_height<=0 or coalesce(p_geometry->>'hostWallId','')=''
      or p_geometry->>'openingKind' not in ('door','window','void')
      or (p_geometry->>'openingKind'='door' and (p_geometry->>'sillHeightMillimeters')::numeric<>0) then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if pg_catalog.jsonb_typeof(p_snapshot_objects)<>'array' then
      raise exception using errcode='P6Q01',message='P4 opening host is unavailable';
    end if;
    select pg_catalog.count(*) into v_host_count
      from pg_catalog.jsonb_array_elements(p_snapshot_objects)
      where value->>'id'=p_geometry->>'hostWallId';
    select value into v_host from pg_catalog.jsonb_array_elements(p_snapshot_objects)
      where value->>'id'=p_geometry->>'hostWallId';
    if v_host_count<>1 or v_host->>'type'<>'wall' then
      raise exception using errcode='P6Q01',message='P4 opening host is unavailable';
    end if;
    v_start_x:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,start,x}');
    v_start_y:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,start,y}');
    v_end_x:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,end,x}');
    v_end_y:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,end,y}');
    v_host_height:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,heightMillimeters}');
    v_dx:=v_end_x-v_start_x; v_dy:=v_end_y-v_start_y;
    v_host_squared:=v_dx*v_dx+v_dy*v_dy;
    if v_host_squared=0 or 2*v_offset-v_width<0
      or (2*v_offset+v_width)*(2*v_offset+v_width)>4*v_host_squared
      or (p_geometry->>'openingKind'='window' and v_sill+v_height>v_host_height) then
      raise exception using errcode='P6Q01',message='P4 opening host is incompatible';
    end if;
    if p_kind='count' then return 1; end if;
    if p_kind='length' then return v_width/1000000000; end if;
    if p_kind='area' then
      return private.lukas_drawing_p6_round_positive(v_width*v_height,1000000)/1000000000000;
    end if;
  elsif v_type='arc' and p_kind='length' then
    perform private.lukas_drawing_p6_scaled_integer(p_geometry#>'{center,x}');
    perform private.lukas_drawing_p6_scaled_integer(p_geometry#>'{center,y}');
    perform private.lukas_drawing_p6_scaled_integer(p_geometry->'startAngleDegrees');
    v_radius:=private.lukas_drawing_p6_scaled_integer(p_geometry->'radius');
    v_sweep:=pg_catalog.abs(private.lukas_drawing_p6_scaled_integer(p_geometry->'sweepAngleDegrees'));
    if v_radius<=0 or v_sweep<=0 or v_sweep>360000000 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    return private.lukas_drawing_p6_round_positive(
      v_radius*v_sweep*3141592653589793,
      180*1000000::numeric*1000000000000000
    )/1000000000;
  elsif v_type='arc' then
    perform private.lukas_drawing_p6_scaled_integer(p_geometry#>'{center,x}');
    perform private.lukas_drawing_p6_scaled_integer(p_geometry#>'{center,y}');
    perform private.lukas_drawing_p6_scaled_integer(p_geometry->'startAngleDegrees');
    v_radius:=private.lukas_drawing_p6_scaled_integer(p_geometry->'radius');
    v_sweep:=pg_catalog.abs(private.lukas_drawing_p6_scaled_integer(p_geometry->'sweepAngleDegrees'));
    if v_radius<=0 or v_sweep<=0 or v_sweep>360000000 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if p_kind='count' then return 1; end if;
  elsif v_type in ('space','area') then
    if pg_catalog.jsonb_typeof(p_geometry->'boundary')<>'array' then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    v_count:=pg_catalog.jsonb_array_length(p_geometry->'boundary');
    if v_count not between 3 and 4096 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    for v_index in 0..v_count-1 loop
      v_next:=(v_index+1)%v_count;
      v_point:=p_geometry->'boundary'->v_index;
      v_next_point:=p_geometry->'boundary'->v_next;
      v_x:=private.lukas_drawing_p6_scaled_integer(v_point->'x');
      v_y:=private.lukas_drawing_p6_scaled_integer(v_point->'y');
      v_next_x:=private.lukas_drawing_p6_scaled_integer(v_next_point->'x');
      v_next_y:=private.lukas_drawing_p6_scaled_integer(v_next_point->'y');
      v_dx:=v_next_x-v_x; v_dy:=v_next_y-v_y;
      if v_dx=0 and v_dy=0 then
        raise exception using errcode='P6Q01',message='P4 geometry is invalid';
      end if;
      v_edges:=pg_catalog.array_append(v_edges,v_dx*v_dx+v_dy*v_dy);
      v_doubled_area:=v_doubled_area+v_x*v_next_y-v_next_x*v_y;
    end loop;
    if v_doubled_area=0 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if p_kind='count' then return 1; end if;
    if p_kind='area' then
      return private.lukas_drawing_p6_round_positive(pg_catalog.abs(v_doubled_area),2000000)/1000000000000;
    elsif p_kind='length' then
      v_precision:=1000000;
      loop
        v_lower:=0; v_uncertainty:=0;
        foreach v_edge in array v_edges loop
          v_root:=private.lukas_drawing_p6_integer_sqrt(v_edge*v_precision*v_precision);
          v_lower:=v_lower+v_root;
          if v_root*v_root<>v_edge*v_precision*v_precision then
            v_uncertainty:=v_uncertainty+1;
          end if;
        end loop;
        v_lower_bucket:=private.lukas_drawing_p6_round_positive(v_lower,v_precision);
        v_upper_bucket:=private.lukas_drawing_p6_round_positive(v_lower+v_uncertainty,v_precision);
        if v_lower_bucket=v_upper_bucket then return v_lower_bucket/1000000000; end if;
        v_precision:=v_precision*1000000;
      end loop;
    end if;
  elsif v_type in ('text','dimension') and p_kind='count' then
    return 1;
  end if;
  raise exception using errcode='P6Q01',message='P4 measurement is unavailable';
exception
  when sqlstate 'P6Q01' then raise;
  when others then
    raise exception using errcode='P6Q01',message='P4 geometry is invalid';
end;
$$;

create function private.lukas_drawing_p6_quantize_calibrated(
  p_value double precision
) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare v_magnitude double precision;
begin
  if p_value<>p_value or pg_catalog.abs(p_value)>9000000000 then
    raise exception using errcode='P6Q01',message='PDF calibration is invalid';
  end if;
  v_magnitude:=pg_catalog.floor(pg_catalog.abs(p_value)*1000000+0.5);
  return (case when p_value<0 then -v_magnitude else v_magnitude end)::numeric/1000000;
exception
  when sqlstate 'P6Q01' then raise;
  when others then
    raise exception using errcode='P6Q01',message='PDF calibration is invalid';
end;
$$;

create function private.lukas_drawing_p6_calibrated_coordinate(
  p_value jsonb,p_extent numeric,p_scale numeric
) returns numeric language plpgsql immutable security invoker set search_path='' as $$
begin
  if pg_catalog.jsonb_typeof(p_value)<>'number'
    or p_extent<=0 or p_scale<=0 then
    raise exception using errcode='P6Q01',message='PDF calibration is invalid';
  end if;
  return private.lukas_drawing_p6_quantize_calibrated(
    ((p_value#>>'{}')::double precision/p_extent::double precision)
      *p_scale::double precision
  );
exception
  when sqlstate 'P6Q01' then raise;
  when others then
    raise exception using errcode='P6Q01',message='PDF calibration is invalid';
end;
$$;

create function private.lukas_drawing_p6_calibrated_point(
  p_point jsonb,p_width numeric,p_height numeric,p_scale numeric
) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
begin
  if private.lukas_drawing_point_valid(p_point) is not true then
    raise exception using errcode='P6Q01',message='PDF calibration is invalid';
  end if;
  return pg_catalog.jsonb_build_object(
    'x',private.lukas_drawing_p6_calibrated_coordinate(
      p_point->'x',p_width,p_scale
    ),
    'y',private.lukas_drawing_p6_calibrated_coordinate(
      p_point->'y',p_height,p_scale
    )
  );
end;
$$;

create function private.lukas_drawing_p6_calibration_valid(p_value jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value)='object'
    and p_value ?& array[
      'normalizedStart','normalizedEnd','realLengthMillimeters',
      'millimetersPerNormalizedUnit'
    ]
    and p_value-array[
      'normalizedStart','normalizedEnd','realLengthMillimeters',
      'millimetersPerNormalizedUnit'
    ]='{}'::jsonb
    and private.lukas_drawing_point_valid(p_value->'normalizedStart') is true
    and private.lukas_drawing_point_valid(p_value->'normalizedEnd') is true
    and pg_catalog.jsonb_typeof(p_value->'realLengthMillimeters')='number'
    and (p_value->>'realLengthMillimeters')::numeric>0
    and pg_catalog.jsonb_typeof(p_value->'millimetersPerNormalizedUnit')='number'
    and (p_value->>'millimetersPerNormalizedUnit')::numeric>0,
    false
  )
$$;

create function private.lukas_drawing_p6_measure_snapshot(
  p_canonical_json jsonb,p_object_id uuid,p_kind text
) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare v_objects jsonb; v_object jsonb; v_layer jsonb; v_canvas jsonb;
declare v_object_count integer; v_layer_count integer; v_canvas_count integer;
declare v_geometry jsonb; v_type text; v_background jsonb; v_calibration jsonb;
declare v_width numeric; v_height numeric; v_scale numeric;
declare v_origin jsonb; v_opposite jsonb; v_points jsonb;
declare v_host jsonb; v_host_geometry jsonb; v_host_count integer;
declare v_horizontal boolean; v_vertical boolean;
begin
  if pg_catalog.jsonb_typeof(p_canonical_json)<>'object'
    or p_canonical_json->>'schemaVersion'<>'2'
    or pg_catalog.jsonb_typeof(p_canonical_json->'objects')<>'array'
    or pg_catalog.jsonb_typeof(p_canonical_json->'layers')<>'array'
    or pg_catalog.jsonb_typeof(p_canonical_json->'canvases')<>'array' then
    raise exception using errcode='P6Q03',message='Drawing snapshot graph is stale';
  end if;
  v_objects:=p_canonical_json->'objects';
  select pg_catalog.count(*),pg_catalog.min(value::text)::jsonb
    into v_object_count,v_object
    from pg_catalog.jsonb_array_elements(v_objects)
    where value->>'id'=p_object_id::text;
  if v_object_count<>1 then
    raise exception using errcode='P6Q03',message='Drawing snapshot object is stale';
  end if;
  select pg_catalog.count(*),pg_catalog.min(value::text)::jsonb
    into v_layer_count,v_layer
    from pg_catalog.jsonb_array_elements(p_canonical_json->'layers')
    where value->>'id'=v_object->>'layerId';
  if v_layer_count<>1
    or v_layer->>'pageId' is distinct from v_object->>'pageId' then
    raise exception using errcode='P6Q03',message='Drawing snapshot layer is stale';
  end if;
  select pg_catalog.count(*),pg_catalog.min(value::text)::jsonb
    into v_canvas_count,v_canvas
    from pg_catalog.jsonb_array_elements(p_canonical_json->'canvases')
    where value->>'id'=v_layer->>'canvasId';
  if v_canvas_count<>1
    or v_canvas->>'pageId' is distinct from v_layer->>'pageId' then
    raise exception using errcode='P6Q03',message='Drawing snapshot canvas is stale';
  end if;
  v_geometry:=v_object->'geometry';
  v_type:=v_geometry->>'type';
  v_background:=v_canvas->'background';
  if v_canvas->>'spaceKind'<>'paper'
    or pg_catalog.jsonb_typeof(v_background)<>'object'
    or pg_catalog.jsonb_typeof(v_background->'pdfPageNumber')<>'number' then
    return private.lukas_drawing_p6_measure(v_geometry,p_kind,v_objects);
  end if;
  v_calibration:=v_background->'calibration';
  if pg_catalog.jsonb_typeof(v_canvas->'widthMillimeters')<>'number'
    or pg_catalog.jsonb_typeof(v_canvas->'heightMillimeters')<>'number'
    or private.lukas_drawing_p6_calibration_valid(v_calibration) is not true then
    raise exception using errcode='P6Q01',message='PDF calibration is required';
  end if;
  v_width:=(v_canvas->>'widthMillimeters')::numeric;
  v_height:=(v_canvas->>'heightMillimeters')::numeric;
  v_scale:=(v_calibration->>'millimetersPerNormalizedUnit')::numeric;
  if v_width<=0 or v_height<=0 or v_scale<=0 then
    raise exception using errcode='P6Q01',message='PDF calibration is invalid';
  end if;

  if v_type in ('line','grid','wall','dimension') then
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{start}',
      private.lukas_drawing_p6_calibrated_point(
        v_geometry->'start',v_width,v_height,v_scale
      ));
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{end}',
      private.lukas_drawing_p6_calibrated_point(
        v_geometry->'end',v_width,v_height,v_scale
      ));
  elsif v_type='polyline' then
    select pg_catalog.jsonb_agg(
      private.lukas_drawing_p6_calibrated_point(
        point.value,v_width,v_height,v_scale
      ) order by point.ordinality
    ) into v_points
    from pg_catalog.jsonb_array_elements(v_geometry->'points')
      with ordinality point(value,ordinality);
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{points}',v_points);
  elsif v_type in ('space','area') then
    select pg_catalog.jsonb_agg(
      private.lukas_drawing_p6_calibrated_point(
        point.value,v_width,v_height,v_scale
      ) order by point.ordinality
    ) into v_points
    from pg_catalog.jsonb_array_elements(v_geometry->'boundary')
      with ordinality point(value,ordinality);
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{boundary}',v_points);
  elsif v_type='rectangle' then
    if v_width<>v_height and (v_geometry->>'rotation')::numeric<>0 then
      raise exception using errcode='P6Q01',
        message='PDF calibration cannot represent this geometry exactly';
    end if;
    v_origin:=private.lukas_drawing_p6_calibrated_point(
      v_geometry->'origin',v_width,v_height,v_scale
    );
    v_opposite:=private.lukas_drawing_p6_calibrated_point(
      pg_catalog.jsonb_build_object(
        'x',(v_geometry#>>'{origin,x}')::numeric+(v_geometry->>'width')::numeric,
        'y',(v_geometry#>>'{origin,y}')::numeric+(v_geometry->>'height')::numeric
      ),v_width,v_height,v_scale
    );
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{origin}',v_origin);
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{width}',pg_catalog.to_jsonb(
      private.lukas_drawing_p6_quantize_calibrated(
        (v_opposite->>'x')::double precision-(v_origin->>'x')::double precision
      )
    ));
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{height}',pg_catalog.to_jsonb(
      private.lukas_drawing_p6_quantize_calibrated(
        (v_opposite->>'y')::double precision-(v_origin->>'y')::double precision
      )
    ));
  elsif v_type in ('circle','arc') then
    if v_width<>v_height then
      raise exception using errcode='P6Q01',
        message='PDF calibration cannot represent this geometry exactly';
    end if;
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{center}',
      private.lukas_drawing_p6_calibrated_point(
        v_geometry->'center',v_width,v_height,v_scale
      ));
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{radius}',pg_catalog.to_jsonb(
      private.lukas_drawing_p6_calibrated_coordinate(
        v_geometry->'radius',v_width,v_scale
      )
    ));
  elsif v_type='opening' then
    select pg_catalog.count(*),pg_catalog.min(value::text)::jsonb
      into v_host_count,v_host
      from pg_catalog.jsonb_array_elements(v_objects)
      where value->>'id'=v_geometry->>'hostWallId';
    if v_host_count<>1 or v_host->>'type'<>'wall' then
      return private.lukas_drawing_p6_measure(v_geometry,p_kind,v_objects);
    end if;
    v_host_geometry:=v_host->'geometry';
    v_horizontal:=(v_host_geometry#>>'{start,y}')::numeric
      =(v_host_geometry#>>'{end,y}')::numeric;
    v_vertical:=(v_host_geometry#>>'{start,x}')::numeric
      =(v_host_geometry#>>'{end,x}')::numeric;
    if not v_horizontal and not v_vertical then
      raise exception using errcode='P6Q01',
        message='PDF calibration cannot represent this geometry exactly';
    end if;
    v_host_geometry:=pg_catalog.jsonb_set(v_host_geometry,'{start}',
      private.lukas_drawing_p6_calibrated_point(
        v_host_geometry->'start',v_width,v_height,v_scale
      ));
    v_host_geometry:=pg_catalog.jsonb_set(v_host_geometry,'{end}',
      private.lukas_drawing_p6_calibrated_point(
        v_host_geometry->'end',v_width,v_height,v_scale
      ));
    v_host_geometry:=pg_catalog.jsonb_set(v_host_geometry,'{thicknessMillimeters}',
      pg_catalog.to_jsonb(private.lukas_drawing_p6_calibrated_coordinate(
        v_host->'geometry'->'thicknessMillimeters',
        case when v_horizontal then v_height else v_width end,v_scale
      )));
    v_host_geometry:=pg_catalog.jsonb_set(v_host_geometry,'{heightMillimeters}',
      pg_catalog.to_jsonb(private.lukas_drawing_p6_calibrated_coordinate(
        v_host->'geometry'->'heightMillimeters',
        case when v_horizontal then v_height else v_width end,v_scale
      )));
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{offsetMillimeters}',
      pg_catalog.to_jsonb(private.lukas_drawing_p6_calibrated_coordinate(
        v_geometry->'offsetMillimeters',
        case when v_horizontal then v_width else v_height end,v_scale
      )));
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{widthMillimeters}',
      pg_catalog.to_jsonb(private.lukas_drawing_p6_calibrated_coordinate(
        v_geometry->'widthMillimeters',
        case when v_horizontal then v_width else v_height end,v_scale
      )));
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{heightMillimeters}',
      pg_catalog.to_jsonb(private.lukas_drawing_p6_calibrated_coordinate(
        v_geometry->'heightMillimeters',
        case when v_horizontal then v_height else v_width end,v_scale
      )));
    v_geometry:=pg_catalog.jsonb_set(v_geometry,'{sillHeightMillimeters}',
      pg_catalog.to_jsonb(private.lukas_drawing_p6_calibrated_coordinate(
        v_geometry->'sillHeightMillimeters',
        case when v_horizontal then v_height else v_width end,v_scale
      )));
    select pg_catalog.jsonb_agg(
      case when item.value->>'id'=v_host->>'id'
        then pg_catalog.jsonb_set(item.value,'{geometry}',v_host_geometry)
        else item.value end order by item.ordinality
    ) into v_objects
    from pg_catalog.jsonb_array_elements(v_objects)
      with ordinality item(value,ordinality);
  end if;
  return private.lukas_drawing_p6_measure(v_geometry,p_kind,v_objects);
exception
  when sqlstate 'P6Q01' or sqlstate 'P6Q03' then raise;
  when others then
    raise exception using errcode='P6Q01',message='PDF calibration is invalid';
end;
$$;

revoke all on function private.lukas_drawing_p6_measure(jsonb,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_quantize_calibrated(double precision),
  private.lukas_drawing_p6_calibrated_coordinate(jsonb,numeric,numeric),
  private.lukas_drawing_p6_calibrated_point(jsonb,numeric,numeric,numeric),
  private.lukas_drawing_p6_calibration_valid(jsonb),
  private.lukas_drawing_p6_measure_snapshot(jsonb,uuid,text)
  from public,anon,authenticated,service_role;

comment on function private.lukas_drawing_p6_measure(jsonb,text,jsonb) is
  'Exact P4_MEASUREMENT_V1 authority for primitive and semantic drawing geometry.';

comment on function private.lukas_drawing_p6_measure_snapshot(jsonb,uuid,text) is
  'SHA-bound P4_MEASUREMENT_V1 authority that resolves PDF calibration from the approved drawing graph.';

create or replace function private.lukas_drawing_insert_quantity_link(
  p_actor_id uuid,p_id uuid,p_revision_id uuid,p_object_id uuid,p_measurement_kind text,
  p_snapshot_sha256 text,p_object_lineage_id uuid,p_object_version bigint,
  p_object_fingerprint text,p_raw_quantity numeric,p_unit text,p_measurement_rule_version text
) returns public.lukas_drawing_quantity_links
language plpgsql security definer set search_path='' as $$
declare v_snapshot public.lukas_drawing_snapshots%rowtype;
declare v_object public.lukas_drawing_objects%rowtype;
declare v_host_object public.lukas_drawing_objects%rowtype;
declare v_result public.lukas_drawing_quantity_links%rowtype;
declare v_status text; v_revision_version bigint; v_digest text;
declare v_snapshot_object jsonb; v_host_snapshot_object jsonb;
declare v_fingerprint text; v_object_count integer; v_host_count integer;
declare v_measure numeric;
begin
  if pg_catalog.current_setting('role',true)<>'service_role' or p_actor_id is null then
    raise exception using errcode='P6A01',message='Trusted quantity authority required';
  end if;
  select * into v_snapshot from public.lukas_drawing_snapshots s
    where s.revision_id=p_revision_id and s.sha256=p_snapshot_sha256 for update;
  if v_snapshot.id is null
    or v_snapshot.schema_version<>2
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'objects')<>'array'
    or v_snapshot.canonical_json->>'schemaVersion'<>'2' then
    raise exception using errcode='P6Q03',message='Drawing approval or snapshot is stale';
  end if;
  select r.status,r.version into v_status,v_revision_version
    from public.lukas_drawing_revisions r
    where r.id=p_revision_id and r.project_id=v_snapshot.project_id for share;
  select * into v_object from public.lukas_drawing_objects o
    where o.id=p_object_id and o.revision_id=p_revision_id
      and o.project_id=v_snapshot.project_id for share;
  v_digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    v_snapshot.canonical_json::text,'UTF8'),'sha256'),'hex');
  select pg_catalog.count(*) into v_object_count
    from pg_catalog.jsonb_array_elements(v_snapshot.canonical_json->'objects')
    where value->>'id'=p_object_id::text;
  select value into v_snapshot_object
    from pg_catalog.jsonb_array_elements(v_snapshot.canonical_json->'objects')
    where value->>'id'=p_object_id::text;
  if v_status not in ('approved','superseded')
    or v_revision_version<>v_snapshot.revision_version
    or v_digest<>v_snapshot.sha256
    or p_measurement_rule_version<>'P4_MEASUREMENT_V1'
    or not exists(
      select 1 from public.lukas_drawing_revision_approvals a
      where a.revision_id=p_revision_id and a.project_id=v_snapshot.project_id
        and a.subject_version=v_snapshot.revision_version
        and a.snapshot_sha256=v_snapshot.sha256 and a.decision='approved'
    ) then
    raise exception using errcode='P6Q03',message='Drawing approval or snapshot is stale';
  end if;
  if v_object.id is null or v_object_count<>1 or v_object.status<>'active'
    or coalesce(private.lukas_drawing_p6_actor_project_role(
      p_actor_id,v_snapshot.project_id),'') not in ('owner','staff','estimator')
    or v_object.lineage_id<>p_object_lineage_id
    or v_object.version<>p_object_version
    or v_snapshot_object->>'lineageId'<>p_object_lineage_id::text
    or v_snapshot_object->>'version'<>p_object_version::text
    or v_snapshot_object->>'name' is distinct from v_object.name
    or v_snapshot_object->>'type' is distinct from v_object.object_type
    or v_snapshot_object->>'pageId' is distinct from v_object.page_id::text
    or v_snapshot_object->>'layerId' is distinct from v_object.layer_id::text
    or v_snapshot_object->'geometry' is distinct from v_object.geometry
    or private.lukas_drawing_geometry_valid(
      v_object.object_type,v_object.geometry
    ) is not true then
    raise exception using errcode='P6Q03',message='Drawing object identity differs';
  end if;
  if v_object.object_type='opening' then
    select pg_catalog.count(*),pg_catalog.min(value::text)::jsonb
      into v_host_count,v_host_snapshot_object
      from pg_catalog.jsonb_array_elements(v_snapshot.canonical_json->'objects')
      where value->>'id'=v_object.host_object_id::text;
    select * into v_host_object from public.lukas_drawing_objects h
      where h.id=v_object.host_object_id and h.revision_id=p_revision_id
        and h.project_id=v_snapshot.project_id for share;
    if v_host_count<>1 or v_host_object.id is null
      or v_host_object.status<>'active' or v_host_object.object_type<>'wall'
      or v_host_object.page_id<>v_object.page_id
      or (select l.canvas_id from public.lukas_drawing_layers l
          where l.id=v_host_object.layer_id and l.revision_id=p_revision_id
            and l.project_id=v_snapshot.project_id)
        is distinct from
        (select l.canvas_id from public.lukas_drawing_layers l
          where l.id=v_object.layer_id and l.revision_id=p_revision_id
            and l.project_id=v_snapshot.project_id)
      or v_host_snapshot_object->>'lineageId'
        is distinct from v_host_object.lineage_id::text
      or v_host_snapshot_object->>'version'
        is distinct from v_host_object.version::text
      or v_host_snapshot_object->>'name' is distinct from v_host_object.name
      or v_host_snapshot_object->>'type' is distinct from 'wall'
      or v_host_snapshot_object->>'pageId'
        is distinct from v_host_object.page_id::text
      or v_host_snapshot_object->>'layerId'
        is distinct from v_host_object.layer_id::text
      or v_host_snapshot_object->'geometry' is distinct from v_host_object.geometry
      or private.lukas_drawing_geometry_valid(
        'wall',v_host_object.geometry
      ) is not true then
      raise exception using errcode='P6Q03',
        message='Drawing opening host identity differs';
    end if;
  end if;
  v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    private.lukas_drawing_p6_canonical_json(pg_catalog.jsonb_build_object(
      'geometry',v_snapshot_object->'geometry','id',v_snapshot_object->'id',
      'name',v_snapshot_object->'name','version',v_snapshot_object->'version'
    )),'UTF8'),'sha256'),'hex');
  if p_object_fingerprint<>v_fingerprint then
    raise exception using errcode='P6Q03',message='Drawing object fingerprint differs';
  end if;
  if (p_measurement_kind='length' and p_unit<>'m')
    or (p_measurement_kind='area' and p_unit<>'m2')
    or (p_measurement_kind='count' and p_unit<>'EA') then
    raise exception using errcode='P6U01',message='Drawing measurement unit differs';
  end if;
  if p_measurement_kind not in ('length','area','count') or p_raw_quantity<0
    or pg_catalog.scale(p_raw_quantity)>12
    or p_raw_quantity>=100000000000000000 then
    raise exception using errcode='P6Q01',message='Drawing measurement is unavailable';
  end if;
  v_measure:=private.lukas_drawing_p6_measure_snapshot(
    v_snapshot.canonical_json,p_object_id,p_measurement_kind
  )::numeric(29,12);
  if v_measure<0 or pg_catalog.scale(v_measure)>12
    or v_measure>=100000000000000000 or p_raw_quantity<>v_measure then
    raise exception using errcode='P6Q01',message='P4 measurement differs';
  end if;
  select * into v_result from public.lukas_drawing_quantity_links
    where id=p_id for share;
  if v_result.id is not null then
    if v_result.project_id=v_snapshot.project_id
      and v_result.drawing_revision_id=p_revision_id
      and v_result.drawing_revision_version=v_snapshot.revision_version
      and v_result.drawing_snapshot_sha256=p_snapshot_sha256
      and v_result.drawing_object_id=p_object_id
      and v_result.drawing_object_lineage_id=p_object_lineage_id
      and v_result.drawing_object_version=p_object_version
      and v_result.object_fingerprint=p_object_fingerprint
      and v_result.measurement_kind=p_measurement_kind
      and v_result.raw_quantity=p_raw_quantity and v_result.unit=p_unit
      and v_result.measurement_rule_version=p_measurement_rule_version
      and v_result.created_by=p_actor_id then return v_result; end if;
    raise exception using errcode='P6O01',message='Quantity replay differs';
  end if;
  insert into public.lukas_drawing_quantity_links(
    id,project_id,drawing_revision_id,drawing_revision_version,
    drawing_snapshot_sha256,drawing_object_id,drawing_object_lineage_id,
    drawing_object_version,object_fingerprint,measurement_kind,raw_quantity,
    unit,measurement_rule_version,created_by
  ) values(
    p_id,v_snapshot.project_id,p_revision_id,v_snapshot.revision_version,
    p_snapshot_sha256,p_object_id,p_object_lineage_id,p_object_version,
    p_object_fingerprint,p_measurement_kind,v_measure,p_unit,
    p_measurement_rule_version,p_actor_id
  ) returning * into v_result;
  return v_result;
exception when unique_violation then
  raise exception using errcode='P6O01',message='Quantity replay differs';
end;
$$;

revoke all on function private.lukas_drawing_insert_quantity_link(
  uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text
) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_insert_quantity_link(
  uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text
) to service_role;

commit;
