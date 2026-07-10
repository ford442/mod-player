fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdEllipse(p: vec2<f32>, ab: vec2<f32>) -> f32 {
  let k = length(p / ab);
  return (k - 1.0) * min(ab.x, ab.y);
}
